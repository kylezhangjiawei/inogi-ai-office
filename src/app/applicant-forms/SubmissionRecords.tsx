import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, RefreshCw, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { ApplicantFormsError, getApplicantFileDownload, getApplicantSubmission, listApplicantSubmissions, updateApplicantSubmission } from '../lib/applicantFormsApi';
import type { FormAnswers, FormField, FormVersion, StoredFile, SubmissionDetail, SubmissionFilters, SubmissionStatus, SubmissionSummary } from '../lib/applicantFormsApi';

const STATUS_LABELS: Record<SubmissionStatus, string> = { new: '新登记', reviewing: '待审核', interview: '面试中', accepted: '已录用', rejected: '未录用', archived: '已归档' };
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试';
function simpleValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '已确认' : '未确认';
  if (typeof value === 'object') return Array.isArray(value) ? value.map((item) => item && typeof item === 'object' ? Object.values(item).map((child) => simpleValue(child)).join(' / ') : item).join('；') : '已上传附件';
  return String(value);
}
function primaryAnswer(row: SubmissionSummary, versions: FormVersion[], kind: 'name' | 'phone' | 'position') {
  const fields = versions.find((version) => version.id === row.versionId)?.schema.fields ?? [];
  const known = { name: ['fullName', 'name'], phone: ['phone', 'phoneNumber'], position: ['position', 'targetJob', 'job'] }[kind];
  const pattern = { name: /^(姓名|应聘人姓名)$/, phone: /^(手机|手机号|手机号码|联系电话)$/, position: /^(应聘岗位|应聘职位|求职岗位)$/ }[kind];
  const field = fields.find((item) => known.includes(item.id)) ?? fields.find((item) => pattern.test(item.label));
  return simpleValue(field ? row.answers[field.id] : known.map((key) => row.answers[key]).find((value) => value !== undefined));
}

function AnswerFields({ fields, answers, files, onDownload }: { fields: FormField[]; answers: FormAnswers; files: StoredFile[]; onDownload: (file: StoredFile) => void }) {
  return <dl className="af-answer-list">{fields.map((field) => {
    const answer = answers[field.id];
    if ((!field.visible || field.stage !== 'application') && answer === undefined) return null;
    const file = answer && typeof answer === 'object' && !Array.isArray(answer) && 'fileId' in answer ? files.find((item) => item.id === answer.fileId) : undefined;
    return <div key={field.id} className={field.type === 'repeat' ? 'af-answer-repeat' : ''}><dt>{field.label}</dt><dd>{field.type === 'repeat' && Array.isArray(answer) ? answer.length ? answer.map((row, index) => <div className="af-answer-group" key={index}><strong>第 {index + 1} 条</strong><AnswerFields fields={field.children ?? []} answers={row as FormAnswers} files={files} onDownload={onDownload} /></div>) : '未填写' : file ? <Button variant="outline" size="sm" onClick={() => onDownload(file)}><FileText size={15} />{file.fileName}<Download size={14} /></Button> : simpleValue(answer)}</dd></div>;
  })}</dl>;
}

function SubmissionDrawer({ id, onClose, onUpdated }: { id: string; onClose: () => void; onUpdated: () => void }) {
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [status, setStatus] = useState<SubmissionStatus>('new');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const changed = !!detail && (note !== detail.note || status !== detail.status);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); getApplicantSubmission(id, controller.signal).then((data) => { setDetail(data); setStatus(data.status); setNote(data.note); setConflict(false); }).catch((err) => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [id, refresh]);
  const close = () => { if (!changed || window.confirm('内部状态或备注尚未保存，是否放弃本次修改？')) onClose(); };
  async function save() {
    if (!detail || conflict) return;
    setSaving(true); setError('');
    try { const updated = await updateApplicantSubmission(id, { expectedRevision: detail.revision, status, note }); setDetail(updated); setStatus(updated.status); setNote(updated.note); toast.success('审核信息已保存'); onUpdated(); }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApplicantFormsError && err.status === 409) setConflict(true); }
    finally { setSaving(false); }
  }
  async function download(file: StoredFile) {
    try { const result = await getApplicantFileDownload(file.id); const link = document.createElement('a'); link.href = result.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = result.fileName; link.click(); } catch (err) { toast.error(errorMessage(err)); }
  }
  return <Sheet open onOpenChange={(open) => { if (!open && !saving) close(); }}><SheetContent closeDisabled={saving} className="horizon-portal af-record-drawer sm:max-w-2xl"><SheetHeader><SheetTitle>登记详情 {detail ? <span className="af-pill">V{detail.version}</span> : null}</SheetTitle><SheetDescription>{detail ? `${formatDate(detail.submittedAt)}（北京时间）提交 · 按填写时版本展示` : '查看登记内容与内部审核信息'}</SheetDescription></SheetHeader><div className="af-drawer-body">{loading ? <div className="af-loading"><Loader2 className="animate-spin" />正在加载登记详情</div> : null}{error ? <div className="af-error" role="alert">{error}{conflict ? <><p>你的备注仍保留在输入框中。请先复制需保留的内容，再读取最新记录。</p><Button variant="outline" size="sm" onClick={() => { if (window.confirm('重新读取将替换当前未保存的审核修改，继续吗？')) setRefresh((value) => value + 1); }}>读取最新记录</Button></> : !detail ? <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>重试</Button> : null}</div> : null}{detail && !loading ? <><div className="af-detail-title"><h3>{detail.schema.title}</h3><p>登记编号：{detail.id}</p></div><AnswerFields fields={detail.schema.fields} answers={detail.answers} files={detail.files} onDownload={download} /><section className="af-review-panel"><h3>内部审核</h3><p>以下内容仅内部可见，不改变应聘人员提交的原始资料。</p><label>处理状态<select value={status} onChange={(e) => setStatus(e.target.value as SubmissionStatus)} disabled={saving}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>内部备注<textarea value={note} maxLength={5000} rows={5} onChange={(e) => setNote(e.target.value)} placeholder="记录跟进情况、面试安排等" disabled={saving} /></label></section></> : null}</div><div className="af-drawer-footer"><Button variant="outline" disabled={saving} onClick={close}>关闭</Button><Button disabled={!changed || saving || conflict || loading} onClick={save}>{saving ? <Loader2 className="animate-spin" size={15} /> : null}保存审核信息</Button></div></SheetContent></Sheet>;
}

const EMPTY_FILTERS: SubmissionFilters = { versionId: '', search: '', status: '', dateFrom: '', dateTo: '', fieldId: '', fieldValue: '', page: 1, pageSize: 20 };
export function SubmissionRecords({ templateId, versions, onRefreshMetadata }: { templateId: string; versions: FormVersion[]; onRefreshMetadata?: () => void | Promise<void> }) {
  const [draftFilters, setDraftFilters] = useState<SubmissionFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<SubmissionFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<SubmissionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [detailId, setDetailId] = useState('');
  const refreshRecords = () => { setRefresh((value) => value + 1); void onRefreshMetadata?.(); };
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); listApplicantSubmissions(templateId, filters, controller.signal).then((result) => { setRows(result.items); setTotal(result.total); }).catch((err) => { if (!controller.signal.aborted) { setError(errorMessage(err)); setRows([]); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [templateId, filters, refresh]);
  const filterFields = useMemo(() => {
    const selected = versions.filter((version) => version.id === draftFilters.versionId);
    const fields = new Map<string, FormField>();
    selected.forEach((version) => version.schema.fields.forEach((field) => { if (!['repeat', 'file'].includes(field.type) && !fields.has(field.id) && field.stage === 'application' && field.visible) fields.set(field.id, field); }));
    return [...fields.values()];
  }, [versions, draftFilters.versionId]);
  const pages = Math.max(1, Math.ceil(total / (filters.pageSize ?? 20)));
  const selectedField = filterFields.find((field) => field.id === draftFilters.fieldId);
  function exportPage() {
    const fields = new Map<string, string>(); versions.forEach((version) => version.schema.fields.forEach((field) => { if (!fields.has(field.id)) fields.set(field.id, field.label); }));
    const cell = (value: string) => `"${(/^(?:[\t\r]|\s*[=+\-@])/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
    const lines = [['登记编号', '版本', '提交时间', '状态', ...fields.values()], ...rows.map((row) => [row.id, `V${row.version}`, formatDate(row.submittedAt), STATUS_LABELS[row.status], ...[...fields.keys()].map((key) => simpleValue(row.answers[key]))])];
    const blob = new Blob(['\uFEFF', lines.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `应聘登记-第${filters.page ?? 1}页.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="af-records af-panel"><div className="af-section-heading"><div><h2>登记记录</h2><p>按发布版本查询，每份资料保留提交时的表单内容。</p></div><div className="af-inline-actions"><Button variant="outline" size="sm" disabled={loading} onClick={refreshRecords}><RefreshCw size={14} />刷新</Button><Button variant="outline" size="sm" disabled={loading || !rows.length} onClick={exportPage}><Download size={14} />导出当前页</Button></div></div><form className="af-record-filters" onSubmit={(event) => { event.preventDefault(); if (draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateFrom > draftFilters.dateTo) { toast.error('开始日期不能晚于结束日期'); return; } if (draftFilters.fieldId && !draftFilters.fieldValue) { toast.error('请填写字段筛选值'); return; } setFilters({ ...draftFilters, page: 1 }); }}><label>表单版本<select value={draftFilters.versionId} onChange={(e) => { const next = { ...draftFilters, versionId: e.target.value, fieldId: '', fieldValue: '', page: 1 }; setDraftFilters(next); setFilters(next); }}><option value="">全部版本</option>{versions.map((version) => <option value={version.id} key={version.id}>V{version.version} · {version.submissionCount} 条登记</option>)}</select></label><label className="af-search-label">搜索<input type="search" value={draftFilters.search} placeholder="姓名、手机号、应聘岗位" onChange={(e) => setDraftFilters({ ...draftFilters, search: e.target.value })} /></label><label>状态<select value={draftFilters.status} onChange={(e) => setDraftFilters({ ...draftFilters, status: e.target.value as SubmissionStatus | '' })}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>提交日期从（北京时间）<input type="date" value={draftFilters.dateFrom} onChange={(e) => setDraftFilters({ ...draftFilters, dateFrom: e.target.value })} /></label><label>至（北京时间）<input type="date" value={draftFilters.dateTo} onChange={(e) => setDraftFilters({ ...draftFilters, dateTo: e.target.value })} /></label><details className="af-record-custom-filter"><summary>更多字段筛选</summary><div className="af-form-two"><label>字段<select disabled={!draftFilters.versionId} value={draftFilters.fieldId} onChange={(e) => setDraftFilters({ ...draftFilters, fieldId: e.target.value, fieldValue: '' })}><option value="">{draftFilters.versionId ? '不筛选' : '请先选择表单版本'}</option>{filterFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label><label>{selectedField?.type === 'number' || selectedField?.type === 'checkbox' ? '答案等于' : '答案包含'}{selectedField?.type === 'checkbox' ? <select value={draftFilters.fieldValue} onChange={(e) => setDraftFilters({ ...draftFilters, fieldValue: e.target.value })}><option value="">请选择</option><option value="true">已确认</option><option value="false">未确认</option></select> : selectedField?.options ? <select disabled={!draftFilters.fieldId} value={draftFilters.fieldValue} onChange={(e) => setDraftFilters({ ...draftFilters, fieldValue: e.target.value })}><option value="">请选择</option>{selectedField.options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input disabled={!draftFilters.fieldId} value={draftFilters.fieldValue} placeholder="填写筛选内容" onChange={(e) => setDraftFilters({ ...draftFilters, fieldValue: e.target.value })} />}</label></div></details><div className="af-filter-actions"><Button type="button" variant="ghost" onClick={() => { setDraftFilters(EMPTY_FILTERS); setFilters({ ...EMPTY_FILTERS }); }}>重置</Button><Button type="submit"><Search size={14} />查询</Button></div></form>{error ? <p className="af-error" role="alert">{error}</p> : null}<div className="af-table-scroll" aria-busy={loading}><table className="af-record-table"><thead><tr><th>应聘人员</th><th>手机号码</th><th>应聘岗位</th><th>版本</th><th>提交时间（北京）</th><th>状态</th><th>操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={7}><div className="af-loading"><Loader2 className="animate-spin" size={18} />正在加载登记记录</div></td></tr> : rows.length ? rows.map((row) => <tr key={row.id}><td><strong>{primaryAnswer(row, versions, 'name')}</strong></td><td>{primaryAnswer(row, versions, 'phone')}</td><td>{primaryAnswer(row, versions, 'position')}</td><td><span className="af-pill">V{row.version}</span></td><td>{formatDate(row.submittedAt)}</td><td><span className={`af-status af-status-${row.status}`}>{STATUS_LABELS[row.status]}</span></td><td><Button variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>查看详情</Button></td></tr>) : <tr><td colSpan={7}><div className="af-empty"><Users size={28} /><h3>暂无登记记录</h3><p>{filters.versionId ? '该版本暂时没有符合条件的登记，试试其他版本或调整筛选。' : '发布表单并分享填写链接后，提交的资料会显示在这里。'}</p></div></td></tr>}</tbody></table></div><div className="af-pagination"><span>共 {total} 条 · 第 {filters.page ?? 1} / {pages} 页</span><div className="af-inline-actions"><Button aria-label="上一页" variant="outline" size="icon" disabled={loading || (filters.page ?? 1) <= 1} onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) - 1 })}><ChevronLeft size={16} /></Button><Button aria-label="下一页" variant="outline" size="icon" disabled={loading || (filters.page ?? 1) >= pages} onClick={() => setFilters({ ...filters, page: (filters.page ?? 1) + 1 })}><ChevronRight size={16} /></Button></div></div>{detailId ? <SubmissionDrawer key={detailId} id={detailId} onClose={() => setDetailId('')} onUpdated={refreshRecords} /> : null}</section>;
}
