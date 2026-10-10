import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { NativeSelect } from '../components/ui/native-select';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, BriefcaseBusiness, Building2, ChevronRight, ClipboardCheck, GraduationCap, LayoutDashboard, ListChecks, Search, ShieldCheck, Users } from 'lucide-react';
import { HorizonEmptyState, HorizonMetric, HorizonMetricGrid, HorizonPageHeader, HorizonSectionHeader } from '../components/horizon/HorizonPage';
import { routePath } from '../lib/routePaths';
import { canReadModule, createHrState, hrModules, type HrProps } from '../../mocks/hrPreview';
import { RecruitmentViews } from './RecruitmentViews';
import { PeopleViews } from './PeopleViews';
import { Badge, Coverage, Notice, Select, WorkViews } from './WorkViews';
import './hr.css';
import { prepareHrNewRecord, prepareHrUpdate, renameHrDepartment, scopeHrRows } from './hrLogic';
import { BusinessWorkViews } from './BusinessWorkViews';
const icons:Record<string,typeof Users>={'HR 工作台':LayoutDashboard,'组织发展':Building2,'招聘':BriefcaseBusiness,'员工关系':Users,'培训与绩效':GraduationCap,'行政会务':ClipboardCheck};
const groups=[...new Set(hrModules.map(m=>m.group))];
const recruiting=['req01','resume','apply','interview','assess','collect','offer'];
const people=['archive','assistant','attendance','account','approval','learning','probation','performance','coach'];
function Home({all}:{all:ReturnType<typeof createHrState>}) {const [query,setQuery]=useState('');const modules=hrModules.filter(m=>`${m.title} ${m.desc} ${m.group}`.includes(query));const due=all.tasks.filter(r=>r.status!=='已完成');return <><HorizonPageHeader Icon={Users} eyebrow="INOGI / HUMAN RESOURCES" title="人事工作台" description="从一次招聘，到每一段成长。把事、岗、人和行政工作连接起来。" actions={<Link className="hr-primary-link" to="/__preview/hr/tasks">进入任务管理<ArrowRight size={16}/></Link>}/><HorizonMetricGrid><HorizonMetric Icon={ListChecks} label="待推进任务" value={due.length} note="当前演示会话" tone="brand"/><HorizonMetric Icon={BriefcaseBusiness} label="招聘需求" value={all.req01.length} note="需求确认与审批"/><HorizonMetric Icon={Users} label="待补齐档案" value={all.archive.filter(r=>r.status!=='已齐全').length} note="材料与合同" tone="warning"/><HorizonMetric Icon={GraduationCap} label="培训已通过" value={all.learning.filter(r=>r.status==='已通过').length} note="已通过的个人课程记录" tone="success"/></HorizonMetricGrid><div className="hr-home-grid"><section className="hr-panel"><HorizonSectionHeader title="今天，从这些工作开始" description="优先推进招聘链与人事任务" trailing={<Link className="hr-text-link" to="/__preview/hr/tasks">全部任务<ArrowRight size={14}/></Link>}/>{due.map(t=><Link key={t.id} to="/__preview/hr/tasks" className="hr-todo"><span className="hr-todo-icon"><ListChecks size={18}/></span><div><strong>{t.title}</strong><small>{t.owner} · 截止 {t.date}</small></div><Badge>{t.status}</Badge><ChevronRight size={15}/></Link>)}</section><section className="hr-panel"><HorizonSectionHeader title="招聘流程" description="从需求确认到员工入职，按流程继续"/><div className="hr-recruit-flow">{[['req01','需求与 JD','业务参与，逐级确认'],['resume','筛选与复核','保留依据，校准差异'],['interview','面试与测评','分别评价，统一记录'],['offer','录用与入职','审批、资料采集与归档']].map(([id,title,desc],i)=><Link key={id} to={`/__preview/hr/${id}`}><span>{i+1}</span><div><strong>{title}</strong><small>{desc}</small></div><ChevronRight size={14}/></Link>)}</div></section></div><section className="hr-catalog"><div className="hr-catalog-heading"><div><h2>人事业务全景</h2><p>按工作场景进入，已有功能可直达正式页面。</p></div><label className="hr-search"><Search size={16}/><Input aria-label="搜索业务页面" placeholder="搜索业务页面" value={query} onChange={e=>setQuery(e.target.value)}/></label></div>{groups.map(group=>{const list=modules.filter(m=>m.group===group);const Icon=icons[group];return list.length?<div className="hr-catalog-group" key={group}><div className="hr-group-label"><Icon size={17}/><h3>{group}</h3><span>{list.length}</span></div><div className="hr-catalog-links">{list.map(m=><Link key={m.id} to={`/__preview/hr/${m.id}`}><div><strong>{m.title}</strong><p>{m.desc}</p></div><span className="hr-catalog-arrow"><ArrowRight size={16}/></span></Link>)}</div></div>:null;})}{!modules.length&&<HorizonEmptyState Icon={Search} title="没有找到相关页面" description="试试招聘、培训、考勤等关键词。"/>}</section><details className="hr-coverage"><summary>查看需求对照与待接入清单 · 25 条</summary><Coverage/></details></>;}
export function HrPreview() {
  const { module: moduleId } = useParams();
  const [all, setAll] = useState(createHrState);
  const allRef = useRef(all);
  const [role, setRole] = useState('人力负责人');
  const [employeeId, setEmployeeId] = useState('E-001');
  const [feedback, setFeedback] = useState('');
  useEffect(() => { document.getElementById('main-content')?.scrollTo({ top: 0 }); setFeedback(''); }, [moduleId]);
  const module = hrModules.find(m => m.id === moduleId);
  const readable = !module || canReadModule(module.id, role);
  const identityRows = [...new Map([...all.archive, ...all.collect].map(r => [r.fields['人员编号'] || r.id, r])).entries()];
  const employee = identityRows.find(([id]) => id === employeeId)?.[1] || all.archive[0];
  const department = employee?.dept || '研发注册部';
  const notify = (message: string) => setFeedback(message);
  const publish = (state: typeof all) => { allRef.current = state; setAll(state); };
  const add: HrProps['add'] = (target, record) => {
    const id = `${target.toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const state = allRef.current;
    publish({ ...state, [target]: [...(state[target] || []), { ...prepareHrNewRecord(target, record, state), id, history: ['本次演示 · 创建记录'] }] });
    notify('已保存到本次演示会话；刷新后恢复样例。');
    return id;
  };
  const updateModule: HrProps['updateModule'] = (target, id, patch, event) => {
    const state = allRef.current;
    const previous = state[target]?.find(r => r.id === id);
    if (!previous) { notify('未找到关联记录，请重新选择。'); return; }
    const next = prepareHrUpdate(target, previous, patch, event);
    let updated = { ...state, [target]: state[target].map(r => r.id === id ? next : r) };
    if (target === 'org' && previous.title !== next.title) {
      updated = renameHrDepartment(updated, previous.title, next.title);
    }
    publish(updated);
    notify(previous.status === '已批准' && next.status === '草稿' ? '关键内容已变更：批准已撤销，请重新审批。' : event || '已更新本次演示记录');
  };
  const update: HrProps['update'] = (id, patch, event) => {
    if (module && readable) updateModule(module.id, id, patch, event);
  };
  const rows = module ? scopeHrRows(module.id, all[module.id] || [], role, employeeId, department) : [];
  const p: HrProps | null = module ? { module, rows, all, role, employeeId, department, update, updateModule, add, notify } : null;
  const Icon = module ? icons[module.group] : Users;
  return <div className="hr-app hr-embedded">
    <div className="hr-content">
      <section className="hr-demo-tools" aria-label="HR 演示设置">
        <div className="hr-demo-toolbar">
          <div className="hr-demo-title"><ShieldCheck size={16} /><strong>交互预览</strong><span>需求 V2.3</span></div>
          <div className="hr-role">
            <label className="hr-demo-field hr-identity"><span>演示员工</span><NativeSelect aria-label="演示员工" value={employeeId} onChange={e => { setEmployeeId(e.target.value); setFeedback(''); }}>
              {identityRows.map(([id, person]) => <option key={id} value={id}>{person.title} · {person.dept}</option>)}
            </NativeSelect></label>
            <label className="hr-demo-field"><span>演示角色</span><Select label="演示角色" value={role} onChange={value => { setRole(value); setFeedback(''); }} options={['人力负责人', '员工关系岗', '部门负责人', '总经理', '员工本人']} /></label>
          </div>
        </div>
        <p className="hr-demo-disclaimer">匿名示例数据 · 操作仅在当前会话生效，刷新恢复 · AI、消息发送、外部同步与真实审批未接入</p>
      </section>
        {feedback && <div className="hr-feedback" role="status"><ShieldCheck size={16} /><span>{feedback}</span><Button variant="unstyled" aria-label="关闭提示" onClick={() => setFeedback('')}>×</Button></div>}
        {moduleId && !module ? <HorizonEmptyState Icon={Search} title="没有找到这个 HR 页面" action={<Link to="/__preview/hr">返回人事工作台</Link>} /> : !module ? <Home all={all} /> : <>
          <HorizonPageHeader className="hr-module-heading" Icon={Icon} eyebrow={module.group} title={module.title} description={module.desc} actions={module.existing ? <Link className="hr-secondary-link" to={routePath(...module.existing)}>打开现有业务页面<ArrowRight size={15} /></Link> : undefined} />
          <details className="hr-scope-note"><summary>{module.source} · 查看需求覆盖与接入状态</summary><p>{module.gap}</p><p>本页为可交互演示。身份和审批为前端范围预演；真实权限、系统同步及业务存储待接入。</p></details>
          {!readable ? <section className="hr-panel"><HorizonEmptyState Icon={ShieldCheck} title="当前演示角色不可查看此页面" description={module.id === 'dashboard' ? '管理统计仅限人力负责人和总经理。' : '此页面面向招聘或人事管理角色。个人资料请通过员工档案及信息采集页查看。'} /><Notice>这是前端可见范围演示。正式上线前须在后端校验权限。</Notice></section> : p ? <div key={`${module.id}-${role}-${employeeId}`}>
            {recruiting.includes(module.id) ? <RecruitmentViews p={p} /> : people.includes(module.id) ? <PeopleViews p={p} /> : module.id === 'tasks' ? <WorkViews p={p} /> : <BusinessWorkViews p={p} />}
          </div> : null}
        </>}
    </div>
  </div>;
}
