import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, CheckCircle2, LockKeyhole } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { NativeSelect } from '../components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Textarea } from '../components/ui/textarea';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import type { HrProps, HrRecord } from '../../mocks/hrPreview';
import { Attachment, Badge, Desk, Notice, Timeline, ViewSwitch } from './WorkViews';
import { canEditProbationStage, probationComplete, isHr, personCourses, personId, probationStage, saveProbationStage, type ProbationStage } from './peopleLogic';

const questions = [{ title: '遇到跨部门协作事项，首先应当做什么？', options: ['明确目标、责任人与交付时间', '等待其他人主动处理', '直接跳过流程'], answer: 0 }, { title: '整理业务资料后，应如何处理？', options: ['不核对直接发布', '核对事实并由责任人确认', '删除全部来源'], answer: 1 }];
export function scopedPeople(p: HrProps) { return p.all.archive.filter(r => p.role === '员工本人' ? personId(r) === p.employeeId : p.role === '部门负责人' ? r.dept === p.department : true); }
export function Learning({ p }: { p: HrProps }) {
  const [search] = useSearchParams();
  const people = scopedPeople(p);
  const [employee, setEmployee] = useState(search.get('employee') || p.employeeId);
  const person = people.find(r => personId(r) === employee) || people[0];
  const [stage, setStage] = useState('新员工'), [selected, setSelected] = useState(''), [answers, setAnswers] = useState<Record<number, number>>({}), [exam, setExam] = useState(false), [message, setMessage] = useState(''), [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  if (!person) return <Notice>当前范围内没有员工档案，请先完成信息采集与归档。</Notice>;
  const courses = personCourses(p.all.learning, person, p.all.org), rows = courses.filter(r => r.fields['课程阶段'] === stage);
  const row = rows.find(r => r.fields['课程编号'] === selected) || rows[0], index = rows.findIndex(r => r.id === row?.id);
  const limitKey = `${personId(person)}:${row?.fields['课程编号'] || ''}`;
  const limit = limitDrafts[limitKey] ?? row?.fields['最多考试次数'] ?? '3';
  const locked = stage === '新员工' && rows.slice(0, index).some(r => r.status !== '已通过');
  const attempts = Number(row?.fields['已考次数'] || 0), maximum = Number(row?.fields['最多考试次数'] || 3), read = Boolean(row?.fields['已阅读']);
  const limitError = !limit.trim() || !Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 10 ? '请填写 1–10 的整数考试次数。' : Number(limit) < attempts ? `考试次数上限不能低于已考 ${attempts} 次。` : '';
  function pick(id = '') { setSelected(id); setAnswers({}); setExam(false); setMessage(''); }
  function persist(record: HrRecord, status: string, fields: Record<string, string>, event: string) {
    const next = { ...record.fields, ...fields, '人员编号': personId(person), '课程编号': record.fields['课程编号'] };
    if (record.fields['进度记录编号']) p.updateModule('learning', record.fields['进度记录编号'], { status, fields: next }, event);
    else { const { id, history, ...copy } = record; p.add('learning', { ...copy, dept: person.dept, owner: person.title, status, fields: next }); }
  }
  return <><section className="hr-panel hr-toolbar hr-panel-body"><label>学习对象<NativeSelect aria-label="学习对象" value={personId(person)} onChange={e => { setEmployee(e.target.value); pick(); }}>{people.map(r => <option key={r.id} value={personId(r)}>{r.title} · {r.dept} · {personId(r)}</option>)}</NativeSelect></label><Badge>{courses.filter(r => r.status === '已通过').length} / {courses.length} 门通过</Badge><Link className="hr-text-link" to="/__preview/hr/archive">查看个人档案与学习路径</Link></section><Notice>当前对象：{person.title} · {person.dept}。课程进度与考试成绩按人员编号独立保存；前三个月包含岗位课程。课程内容、题库和通过线为演示，正式课件待部门确认。</Notice><div className="hr-toolbar hr-learning-tabs"><ViewSwitch label="学习阶段" value={stage} onChange={value => { setStage(value); pick(); }} options={['新员工', '初级', '中级', '高级'].map(s => ({ value: s, label: s === '新员工' ? '新员工 · 前 3 个月' : `${s}专业课程` }))}/></div><div className="hr-learning"><section className="hr-panel"><HorizonSectionHeader title={stage === '新员工' ? '新员工成长路径' : '专业能力课程'}/><ol className="hr-learning-path">{rows.map((r, i) => <li key={r.fields['课程编号']}><Button variant="unstyled" className="hr-course" aria-pressed={row?.id === r.id} onClick={() => pick(r.fields['课程编号'])}><span className="hr-course-step">{r.status === '已通过' ? <CheckCircle2 size={20}/> : stage === '新员工' && rows.slice(0, i).some(c => c.status !== '已通过') ? <LockKeyhole size={18}/> : i + 1}</span><div><small>{r.fields['学习周期']} · {r.fields['适用部门']}</small><h3>{r.title}</h3><Badge>{r.status}</Badge></div></Button></li>)}</ol>{!rows.length && <Notice>本部门尚未配置此阶段课程；可先完成新员工岗位课程，正式课程由培训负责人配置。</Notice>}</section>{row && <section className="hr-panel hr-lesson"><HorizonSectionHeader title={row.title} description={`${person.title} · ${row.fields['学习周期']} · 学后即考`}/>{locked ? <Notice>请先通过前置课程考试，之后解锁本课程。</Notice> : <><div className="hr-lesson-content"><BookOpen size={24}/><h3>课程摘要 · {row.fields['岗位课程'] ? person.fields['岗位'] || person.dept : '通识演示'}</h3><p>{row.fields['课程摘要'] || '明确工作目标、责任人与协作关系；执行时保留关键事实，验证结果并及时沟通风险。'}</p><p>实践任务：结合“{row.title}”记录一个岗位场景，明确交付物、核对依据与复盘时间。使用 AI 整理资料须保留原始依据，由责任人确认。</p><p>课程为前端演示摘要，正式课程视频、课件与岗位题库待上传。</p></div><div className="hr-actions"><Button variant="outline" onClick={() => persist(row, row.status === '已通过' ? '已通过' : '学习中', { '已阅读': '是' }, '完成课程阅读（演示）')}>{read ? '已完成阅读' : '标记已完成阅读'}</Button><Button disabled={!read || attempts >= maximum || row.status === '已通过'} onClick={() => { setExam(true); setAnswers({}); setMessage(''); }}>开始考试</Button></div><p className="hr-subtle">已考 {attempts} / {maximum} 次 · 演示通过线 80 分{row.fields['考试成绩'] && ` · 最近成绩 ${row.fields['考试成绩']} 分`}</p>{exam && <div className="hr-quiz">{questions.map((q, i) => <fieldset key={q.title}><legend id={`question-${personId(person)}-${i}-title`}>{i + 1}. {q.title}</legend><RadioGroup aria-labelledby={`question-${personId(person)}-${i}-title`} name={`question-${personId(person)}-${i}`} value={answers[i] === undefined ? '' : String(answers[i])} onValueChange={value => setAnswers(v => ({ ...v, [i]: Number(value) }))}>{q.options.map((o, j) => <label key={o} htmlFor={`question-${personId(person)}-${i}-${j}`}><RadioGroupItem id={`question-${personId(person)}-${i}-${j}`} value={String(j)}/>{o}</label>)}</RadioGroup></fieldset>)}<Button disabled={Object.keys(answers).length !== questions.length || attempts >= maximum} onClick={() => { const score = questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 50 : 0), 0); persist(row, score >= 80 ? '已通过' : '学习中', { '已考次数': String(attempts + 1), '考试成绩': String(score) }, `考试 ${score} 分，${score >= 80 ? '通过' : '未通过'}`); setExam(false); setMessage(`${person.title}本次 ${score} 分，${score >= 80 ? '已同步本人档案和试用期成绩。' : '请复习后再考。'}`); }}>提交试卷</Button></div>}{message && <p role="status" className="hr-notice">{message}</p>}{isHr(p.role) && <><div className="hr-inline-form"><label>该员工最多考试次数<Input aria-label="该员工最多考试次数" aria-invalid={Boolean(limitError)} aria-describedby={limitError ? `learning-limit-${limitKey}-error` : undefined} type="number" min="1" max="10" value={limit} onChange={e => { setLimitDrafts(v => ({ ...v, [limitKey]: e.target.value })); setMessage(''); }}/></label><Button variant="outline" disabled={Boolean(limitError)} onClick={() => { if (limitError) return; persist(row, row.status, { '最多考试次数': limit }, '调整本人允许考试次数'); setMessage(`已保存 ${person.title} 的考试次数上限：${limit} 次。`); }}>保存设置</Button></div>{limitError && <p id={`learning-limit-${limitKey}-error`} role="alert" className="hr-error">{limitError}</p>}</>}<Timeline row={row}/></>}</section>}</div></>;
}

const stages = ['30 天', '60 天', '90 天'];
function ProbationDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const [stage, setStage] = useState(row.fields['考核阶段'] || '30 天');
  const [drafts, setDrafts] = useState<Record<string, ProbationStage>>({});
  const [error, setError] = useState<{ action: 'draft' | 'self' | 'feedback'; message: string } | null>(null);
  const errorId = `${row.id}-probation-error`;
  const saved = probationStage(row, stage), draft = drafts[stage] || saved;
  const person = p.all.archive.find(r => personId(r) === personId(row));
  const passed = person ? personCourses(p.all.learning, person, p.all.org).filter(r => r.status === '已通过') : [];
  const employee = p.role === '员工本人' && personId(row) === p.employeeId;
  const manager = isHr(p.role) || (p.role === '部门负责人' && row.dept === p.department);
  const stageReady = canEditProbationStage(row, stage);
  const locked = saved.status === '已评议' || !stageReady;
  const edit = (patch: Partial<ProbationStage>) => { setDrafts(v => ({ ...v, [stage]: { ...draft, ...patch } })); setError(null); };
  function save(action: 'draft' | 'self' | 'feedback') {
    if (!stageReady) { setError({ action, message: '请先完成前置阶段的自评与上级评议' }); return; }
    if (!draft.goal.trim() || !draft.plan.trim()) { setError({ action, message: '请填写阶段目标和计划任务' }); return; }
    if (action === 'self' && (!draft.self.trim() || !draft.progress.trim())) { setError({ action, message: '请填写完成情况和自评后提交' }); return; }
    if (action === 'feedback' && (!draft.feedback.trim() || saved.status !== '待上级反馈')) { setError({ action, message: '请先提交自评，再填写上级反馈' }); return; }
    const next = { ...draft, status: action === 'self' ? '待上级反馈' : action === 'feedback' ? '已评议' : '待自评' };
    p.update(row.id, saveProbationStage(row, stage, next), `${stage}：${action === 'self' ? '员工提交自评' : action === 'feedback' ? '保存上级反馈' : '保存阶段计划和完成情况'}`);
    setDrafts(v => ({ ...v, [stage]: next })); setError(null);
  }
  function nextStage() {
    if (!stageReady || saved.status !== '已评议') return;
    const next = stages[stages.indexOf(stage) + 1]; if (!next) return;
    const value = probationStage(row, next);
    p.update(row.id, saveProbationStage(row, next, { ...value, goal: value.goal || (next === '60 天' ? '独立完成岗位核心交付并形成复盘' : '稳定独立交付，完成转正总结'), plan: value.plan || '明确任务、里程碑和验收依据' }), `完成 ${stage}，进入 ${next}`); setStage(next); setError(null);
  }
  return <><ViewSwitch label="试用期考核阶段" value={stage} onChange={value => { setStage(value); setError(null); }} options={stages.map(s => ({ value: s, label: `${s} · ${probationStage(row, s).status}` }))}/>{!stageReady && <Notice>当前阶段仅供查看。请先完成前置阶段的自评与上级评议，之后才能编辑或提交。</Notice>}<Notice>{stage}独立记录 · {saved.status}。保存到其他阶段不会覆盖当前资料。员工可更新本人计划、完成情况与自评；上级负责阶段目标及反馈。</Notice><div className="hr-form-grid"><label className="hr-wide">阶段目标<Textarea aria-label="阶段目标" disabled={!manager || locked || saved.status !== '待自评'} value={draft.goal} onChange={e => edit({ goal: e.target.value })}/></label><label className="hr-wide">计划任务<Textarea aria-label="计划任务" disabled={!(employee || manager) || locked || saved.status === '待上级反馈'} value={draft.plan} onChange={e => edit({ plan: e.target.value })}/></label><label className="hr-wide">完成情况<Textarea aria-label="完成情况" disabled={!(employee || manager) || locked || saved.status === '待上级反馈'} value={draft.progress} onChange={e => edit({ progress: e.target.value })}/></label></div>{!locked && (employee || manager) && <Attachment key={stage} storageKey={`probation-${row.id}-${stage}`} label={`${stage}任务书`} accept=".pdf,.xlsx,.docx" onChange={name => { const next = { ...draft, attachment: name }; edit({ attachment: name }); p.update(row.id, saveProbationStage(row, stage, next), `${stage}本地选择任务书`); }}/>}<p className="hr-subtle">已登记任务书：{draft.attachment || '尚未选择'}</p><Button variant="outline" disabled={!(employee || manager) || locked || saved.status === '待上级反馈'} aria-describedby={error?.action === 'draft' ? errorId : undefined} onClick={() => save('draft')}>保存本阶段计划 / 完成情况</Button>{error?.action === 'draft' && <p id={errorId} role="alert" className="hr-error">{error.message}</p>}<Notice>{row.title}培训：{passed.length} 门已通过。{passed.map(r => `${r.title} ${r.fields['考试成绩']} 分`).join('；') || '尚无成绩'}</Notice><Link className="hr-text-link" to={`/__preview/hr/learning?employee=${encodeURIComponent(personId(row))}`}>进入本人学习地图</Link><label>完成情况自评<Textarea aria-label="完成情况自评" disabled={!employee || !stageReady || saved.status !== '待自评'} value={draft.self} onChange={e => edit({ self: e.target.value })}/></label><Button disabled={!employee || saved.status !== '待自评'} aria-describedby={error?.action === 'self' ? errorId : undefined} onClick={() => save('self')}>提交阶段自评</Button>{error?.action === 'self' && <p id={errorId} role="alert" className="hr-error">{error.message}</p>}<label>上级沟通反馈<Textarea aria-label="上级沟通反馈" disabled={!manager || !stageReady || saved.status !== '待上级反馈'} value={draft.feedback} onChange={e => edit({ feedback: e.target.value })}/></label><div className="hr-actions"><Button variant="outline" disabled={!manager || saved.status !== '待上级反馈'} aria-describedby={error?.action === 'feedback' ? errorId : undefined} onClick={() => save('feedback')}>保存上级反馈</Button>{manager && stageReady && saved.status !== '待自评' && <Button variant="outline" onClick={() => { const next = { ...saved, status: '待自评', self: '', feedback: '' }; p.update(row.id, saveProbationStage(row, stage, next), `${stage}退回员工补充；原自评与反馈已留操作记录：${saved.self} / ${saved.feedback}`); setDrafts(v => ({ ...v, [stage]: next })); setError(null); }}>退回本阶段补充</Button>}{manager && stageReady && saved.status === '已评议' && stage !== '90 天' && <Button onClick={nextStage}>推进下一阶段</Button>}</div>{error?.action === 'feedback' && <p id={errorId} role="alert" className="hr-error">{error.message}</p>}{probationComplete(row) && stage === '90 天' && <Notice>三阶段记录已可汇总供转正评议。正式转正审批及 AI 综合评价待接入。</Notice>}</>;
}
export function Probations({ p }: { p: HrProps }) {
  const [employee, setEmployee] = useState(p.employeeId);
  const missing = scopedPeople(p).filter(person => !p.all.probation.some(r => personId(r) === personId(person)));
  const target = missing.find(r => personId(r) === employee) || missing[0];
  return <div className="hr-form-workspace">{(isHr(p.role) || p.role === '部门负责人') && missing.length > 0 && <section className="hr-panel hr-toolbar hr-panel-body"><label>建立试用期任务<NativeSelect aria-label="建立试用期任务的员工" value={target && personId(target)} onChange={e => setEmployee(e.target.value)}>{missing.map(r => <option key={r.id} value={personId(r)}>{r.title} · {personId(r)}</option>)}</NativeSelect></label><Button onClick={() => p.add('probation', { title: target.title, dept: target.dept, owner: p.role, date: target.fields['预计转正日期'] || '2026-12-01', status: '待自评', detail: '', fields: { '人员编号': personId(target), '岗位': target.fields['岗位'] || '', '考核阶段': '30 天', '阶段目标': '了解岗位要求与协作流程', '计划任务': '完成通识与岗位课程，制定工作计划', '完成情况': '', '自评': '', '上级反馈': '' } })}>建立 30 / 60 / 90 天考核</Button></section>}<Desk p={p} allowNew={false} allowEdit={false}>{row => <ProbationDetail p={p} row={row}/>}</Desk></div>;
}
