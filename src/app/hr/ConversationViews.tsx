import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Send, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import type { HrProps } from '../../mocks/hrPreview';
import { Badge, Notice, Select } from './WorkViews';
import { isHr, personId } from './peopleLogic';

type Message = { role: string; text: string; source?: string; missing?: boolean };
const knowledge = [
  { id: 'KB-DEMO-01', title: '入职资料填写指引', version: '2026-10 演示版', keywords: ['入职', '资料', '材料', '毕业', '邮箱'], answer: '请在员工信息采集页补充联系方式、教育及工作经历，并由 HR 核对。材料缺失项在员工档案中查看。示例清单含身份证明、学历证明和相关证书，实际要求以正式通知为准。', module: 'collect', text: '适用对象：新员工。本人填写基本资料、联系与紧急联系人、教育和工作经历；提交后由 HR 核对，并关联到本人档案。原件只在本地选择查看，未上传服务器。' },
  { id: 'KB-DEMO-02', title: '考勤异议核对指引', version: '2026-10 演示版', keywords: ['考勤', '请假', '补卡', '出勤', '制度'], answer: '先核对本人审批 / 抄送记录，记录存在差异的日期、门禁与审批凭据，再由 HR 逐条确认采用依据。此示例不规定假期额度和计薪政策。', module: 'approval', text: '审批归集可按申请类型与日期查询；HR 对照门禁小时和审批认可小时填写采用依据。半天、小时折算使用明确的每日小时参数。所有政策数值须以公司正式制度为准。' },
  { id: 'KB-DEMO-03', title: '学习与试用期操作指引', version: '2026-10 演示版', keywords: ['学习', '培训', '考试', '课程', '试用', '转正'], answer: '在学习地图选择本人，按路径完成通识与前三个月岗位课程，阅读后考试。通过成绩按人员编号同步到本人档案与试用期考核；30 / 60 / 90 天各自保存计划和自评。', module: 'learning', text: '新员工前置课程通过后解锁后续课程。考试次数按个人课程记录保存，演示通过线为 80 分。员工填写阶段计划、完成情况和自评，上级提交反馈后推进下一阶段。' },
];
function useMessageScroll(messages: Message[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages]);
  return ref;
}

function KnowledgeAssistant({ p }: { p: HrProps }) {
  const [query, setQuery] = useState(''), [messages, setMessages] = useState<Message[]>([]), [source, setSource] = useState('');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const messagesRef = useMessageScroll(messages);
  const sourceRef = useRef<HTMLElement>(null);
  const tickets = p.all.assistant.filter(r => personId(r) === p.employeeId);
  const pending = (question: string) => tickets.some(r => r.fields['问题']?.trim() === question.trim() && r.status === '待人工回复');
  function openSource(id: string) {
    setSource(id);
    requestAnimationFrame(() => {
      sourceRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
      sourceRef.current?.focus({ preventScroll: true });
    });
  }
  function send(text = query) { text = text.trim(); if (!text) return; const found = knowledge.find(k => k.keywords.some(word => text.includes(word))); setMessages(v => [...v, { role: '我', text }, { role: '知识库结果（示例）', text: found?.answer || '演示知识库未命中。可转入人工服务队列，补充问题与联系方式；当前不会发送给真实 HR。', source: found?.id, missing: !found }]); setQuery(''); }
  function handoff(index: number) {
    const question = messages[index - 1]?.text || '';
    if (!question.trim()) return;
    if (pending(question)) { p.notify('该问题已进入演示人工队列'); return; }
    const person = p.all.archive.find(r => personId(r) === p.employeeId);
    p.add('assistant', { title: `人工咨询 · ${question.slice(0, 22)}`, dept: person?.dept || p.department, owner: person?.title || p.employeeId, date: '2026-10-09', status: '待人工回复', detail: '', fields: { '人员编号': p.employeeId, '问题': question, '来源': '演示知识库未命中', '人工回复': '' } });
  }
  const selected = knowledge.find(k => k.id === source);
  return <div className="hr-conversation hr-assistant">

    <section className="hr-panel hr-chat"><HorizonSectionHeader title="有什么可以帮你？" description={`员工 ${p.employeeId} · 本人服务范围`} />
      <div className="hr-messages" ref={messagesRef} role="log" aria-label="客服对话" aria-live="polite">
        {!messages.length ? <div className="hr-chat-empty"><ShieldCheck size={32} /><h3>查找指引，继续办理</h3><p>输入入职、考勤或学习问题。未命中的问题可进入演示人工队列。</p></div> : messages.map((m, i) => {
          const queued = pending(messages[i - 1]?.text || '');
          return <article className="hr-message" data-role={m.role === '我' ? 'user' : 'assistant'} key={i}><small>{m.role}</small><p>{m.text}</p>
            {m.source && <Button variant="outline" size="sm" onClick={() => openSource(m.source!)}>查看出处 · {m.source}</Button>}
            {m.missing && <Button variant="outline" size="sm" disabled={queued} onClick={() => handoff(i)}>{queued ? '已进入人工队列' : '转人工（演示）'}</Button>}
          </article>;
        })}
      </div>
      <div className="hr-suggestions">{['新员工需要准备哪些材料？', '如何查找考勤记录？', '在哪里查看学习任务？'].map(text => <Button variant="unstyled" key={text} onClick={() => send(text)}>{text}</Button>)}</div>
      <form className="hr-chat-input" onSubmit={e => { e.preventDefault(); send(); }}><Input aria-label="对话内容" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入你的问题…" /><Button type="submit" disabled={!query.trim()}><Send size={16} /><span className="sr-only">发送</span></Button></form>
      {tickets.length > 0 && <section className="hr-attachment hr-chat-card"><h3>我的人工咨询 · 演示队列</h3>{tickets.map(ticket => {
        const reply = replies[ticket.id] || '';
        return <article key={ticket.id} className="hr-ticket"><div className="hr-ticket-heading"><strong>{ticket.fields['问题']}</strong><Badge>{ticket.status}</Badge></div><p>{ticket.fields['人工回复'] || '等待 HR 演示回复；未发送任何消息。'}</p>
          {isHr(p.role) && ticket.status === '待人工回复' && <><label>模拟 HR 回复<Textarea aria-label={`回复咨询：${ticket.fields['问题']}`} value={reply} onChange={e => setReplies(current => ({ ...current, [ticket.id]: e.target.value }))} /></label><Button disabled={!reply.trim()} onClick={() => {
            if (!isHr(p.role) || !reply.trim()) return;
            p.updateModule('assistant', ticket.id, { status: '已回复', fields: { ...ticket.fields, '人工回复': reply.trim() } }, '登记演示人工回复，未发送真实消息');
            setReplies(current => { const next = { ...current }; delete next[ticket.id]; return next; });
          }}>登记人工回复（演示）</Button></>}
        </article>;
      })}</section>}
    </section>
    <aside className="hr-panel"><HorizonSectionHeader title="服务指南" />
      {[['入职资料', 'collect'], ['我的档案', 'archive'], ['培训学习', 'learning'], ['流程记录', 'approval']].map(([title, module]) => <Link key={module} className="hr-service-link" to={`/__preview/hr/${module}`}>{title}<ArrowRight size={15} /></Link>)}
      <h3>可检索知识 · 3 篇演示内容</h3>
      {knowledge.map(k => <Button variant="unstyled" className="hr-service-link hr-knowledge-link" key={k.id} onClick={() => openSource(k.id)}><span>{k.title}</span><small>{k.id}</small></Button>)}
      {selected && <article className="hr-attachment hr-knowledge-source" id={selected.id} ref={sourceRef} tabIndex={-1} aria-labelledby={`${selected.id}-title`}><small>{selected.id} · {selected.version}</small><h3 id={`${selected.id}-title`}>{selected.title}</h3><p>{selected.text}</p><Link className="hr-text-link" to={`/__preview/hr/${selected.module}`}>打开相关流程</Link></article>}
      <Notice>来源为本页面内置操作指引，不是已发布的正式制度。真实知识检索、版本校验及客服消息尚未接入。</Notice>
    </aside>
  </div>;
}

function Coach({ p }: { p: HrProps }) {
  const [job, setJob] = useState(p.all.spec[0]?.title || '技术研发序列'), [scene, setScene] = useState('绩效评分异议'), [phase, setPhase] = useState<'ready' | 'practice' | 'help' | 'done'>('ready'), [query, setQuery] = useState(''), [messages, setMessages] = useState<Message[]>([]), [turn, setTurn] = useState(0);
  const messagesRef = useMessageScroll(messages);
  const subject = /质量/.test(job) ? '质量工程师小许' : /生产/.test(job) ? '生产班组长小陆' : '研发工程师小林';
  const work = /质量/.test(job) ? '供应商异常闭环' : /生产/.test(job) ? '生产换线与良率改善' : '样机验证与设计评审';
  const opening = scene === '绩效评分异议' ? `我负责的${work}增加了很多临时任务，评分只有 84 分不公平。我希望重新核对。` : scene === '交付延期沟通' ? `${work}的支持资源一直没有到位，任务延期不能全部算在我头上。` : `我完成了${work}，但不知道下一步该如何成长，希望有明确的发展机会。`;
  const help = ['先承认对方的感受，邀请对方补充一个具体事实；避免立刻争论分数。', `围绕${work}明确原目标、实际结果与可核查证据，同时说明可以提供的资源。`, '把改进意愿写成具体行动、责任人、截止日期和下次复盘时间，并让员工确认。'];
  function start() { setMessages([{ role: `模拟员工 · ${subject}`, text: opening }]); setTurn(0); setPhase('practice'); setQuery(''); }
  function send(text = query) {
    if (!text.trim() || phase !== 'practice') return;
    const responses = [`我可以具体说明：${work}遇到两次计划外变更，我补充了处理记录。你愿意一起核对吗？`, `核对事实后我能理解差距。下一阶段能否安排固定支持人，并明确${work}的验收标准？`, '这个方向我愿意尝试。请和我一起写清责任人、完成日期及复盘安排，我会按约定更新进展。'];
    setMessages(v => [...v, { role: '我（管理者）', text: text.trim() }, { role: `模拟员工 · ${subject}`, text: responses[Math.min(turn, 2)] }]); setTurn(v => v + 1); setQuery('');
  }
  const spoken = messages.filter(m => m.role === '我（管理者）').map(m => m.text).join(' ');
  return <div className="hr-conversation hr-coach"><aside className="hr-panel"><HorizonSectionHeader title="面谈准备"/><div className="hr-coach-fields"><label className="hr-coach-field"><span>岗位序列</span><Select label="岗位序列" value={job} onChange={value => { setJob(value); setPhase('ready'); setMessages([]); }} options={[...new Set([...p.all.spec.map(r => r.title), '生产运营序列'])]}/></label><label className="hr-coach-field"><span>练习场景</span><Select label="练习场景" value={scene} onChange={value => { setScene(value); setPhase('ready'); setMessages([]); }} options={['绩效评分异议', '交付延期沟通', '成长发展计划']}/></label></div><h3 className="hr-coach-person">{subject}</h3><p>业务背景：{work}。你扮演直属管理者，模拟员工会先提出顾虑。</p><ol className="hr-checkpoints"><li>核对目标与完成事实</li><li>准备评分差异和具体证据</li><li>列出可提供的资源支持</li><li>约定行动与复盘时间</li></ol><Button onClick={start}>{phase === 'ready' ? '进入模拟场景' : '重新开始场景'}</Button><Notice>这是固定脚本陪练，不是真实 AI 对话或员工心理评估。岗位序列与场景决定模拟员工背景；自由输入保留在本次练习中。</Notice></aside><section className="hr-panel hr-chat"><HorizonSectionHeader title={scene} description={`${job} · ${subject} · ${phase === 'ready' ? '准备中' : phase === 'help' ? '教练提示' : phase === 'done' ? '练习已结束' : `对话第 ${turn + 1} 轮`}`}/><div className="hr-messages" ref={messagesRef} role="log" aria-label="面谈陪练对话" aria-live="polite">{phase === 'ready' ? <div className="hr-chat-empty"><ShieldCheck size={32}/><h3>进入场景后，员工先表达顾虑</h3><p>选择岗位和场景，练习倾听、事实核对与行动约定。</p></div> : messages.map((m, i) => <div className="hr-message" data-role={m.role.startsWith('我') ? 'user' : 'assistant'} key={i}><small>{m.role}</small><p>{m.text}</p></div>)}</div>{phase === 'help' && <section className="hr-attachment hr-chat-card"><h3>教练求助 · 第 {Math.min(turn + 1, 3)} 步</h3><p>{help[Math.min(turn, 2)]}</p><Button onClick={() => setPhase('practice')}>继续与模拟员工对话</Button></section>}{phase === 'practice' && <><div className="hr-panel-footer hr-actions"><Button variant="outline" onClick={() => setPhase('help')}>向教练求助</Button><Button variant="outline" disabled={turn < 1} onClick={() => setPhase('done')}>结束并查看练习记录</Button></div><form className="hr-chat-input" onSubmit={e => { e.preventDefault(); send(); }}><Input aria-label="对话内容" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入你对模拟员工的回应…"/><Button type="submit" disabled={!query.trim()}><Send size={16}/><span className="sr-only">发送</span></Button></form></>}{phase === 'done' && <section className="hr-attachment hr-chat-card"><h3>练习记录 · {turn} 轮</h3><p>以下仅为关键词自查，不代表 AI 分析结果：</p><ol className="hr-checkpoints"><li>倾听感受：{/理解|听|感受|辛苦/.test(spoken) ? '已出现相关表达' : '可补充倾听与回应'}</li><li>核对事实：{/事实|记录|目标|证据/.test(spoken) ? '已出现相关表达' : '可补充具体事实与记录'}</li><li>行动约定：{/时间|日期|复盘|计划|责任/.test(spoken) ? '已出现相关表达' : '可补充行动、责任人与日期'}</li></ol><Button onClick={() => setPhase('practice')}>继续本次练习</Button></section>}</section></div>;
}
export function Conversation({ p }: { p: HrProps }) { return p.module.id === 'coach' ? <Coach p={p}/> : <KnowledgeAssistant p={p}/>; }
