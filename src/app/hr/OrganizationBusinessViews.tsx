import { NativeSelect } from '../components/ui/native-select';
import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import type { HrProps, HrRecord } from '../../mocks/hrPreview';
import { Badge, Desk, Facts, Notice, Select, download } from './WorkViews';
import { buildOrgTree, fieldChanges, type OrgNode } from './businessLogic';
import { canManageModule } from './hrLogic';

export function BusinessFields({ p, children }: { p: HrProps; children: React.ReactNode }) {
  const editable = canManageModule(p.module.id, p.role);
  return <>{!editable && <Notice>当前演示角色可查看资料；更改由有维护权限的角色完成。</Notice>}<fieldset disabled={!editable} className="hr-business-fieldset">{children}</fieldset></>;
}

export function withBusinessFields(p: HrProps, fields: string[]): HrProps {
  return { ...p, module: { ...p.module, fields: [...new Set([...p.module.fields, ...fields])] }, updateModule: (module, id, patch, event) => {
    if (!canManageModule(p.module.id, p.role)) { p.notify('当前演示角色仅可查看此模块。'); return; }
    p.updateModule(module, id, patch, event);
  }, update: (id, patch, event) => {
    if (!canManageModule(p.module.id, p.role)) { p.notify('当前演示角色仅可查看此模块。'); return; }
    const previous = p.rows.find(row => row.id === id);
    const changes = previous ? fieldChanges(previous, patch) : '';
    p.update(id, patch, `${event || '保存资料'}${changes ? ` · ${changes}` : ''}`);
  } };
}

function DepartmentBranch({ node }: { node: OrgNode }) {
  return <li><div className="hr-department-node"><strong>{node.row.title}</strong><small>{node.row.fields['公司主体']} · {node.row.owner}</small><span>{node.row.fields['部门定位'] || '待定义部门定位'}</span></div>{node.children.length > 0 && <ul>{node.children.map(child => <DepartmentBranch key={child.row.id} node={child} />)}</ul>}</li>;
}

function EmployeeRelations({ p, department }: { p: HrProps; department: HrRecord }) {
  const employees = p.all.archive.filter(row => row.dept === department.title);
  const [employeeId, setEmployeeId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const employee = p.all.archive.find(row => row.id === employeeId);
  function choose(id: string) {
    const person = p.all.archive.find(row => row.id === id);
    setEmployeeId(id);
    setDraft(person ? { '公司主体': person.fields['公司主体'] || department.fields['公司主体'] || '', '岗位': person.fields['岗位'] || '', '岗位序列': person.fields['岗位序列'] || '', '直属上级': person.fields['直属上级'] || '', '兼岗信息': person.fields['兼岗信息'] || '' } : {});
    setError('');
  }
  function save() {
    if (!canManageModule(p.module.id, p.role)) { setError('当前演示角色仅可查看组织关系。'); return; }
    if (!employee || !draft['公司主体']?.trim() || !draft['岗位']?.trim() || !draft['岗位序列']?.trim() || !draft['直属上级']?.trim()) { setError('请填写公司主体、岗位、岗位序列和直属上级。'); return; }
    if (draft['直属上级'].trim() === employee.title) { setError('直属上级不能是员工本人。'); return; }
    const employeeNumber = employee.fields['人员编号'] || employee.id;
    const patch = { dept: department.title, fields: { ...employee.fields, ...draft, '人员编号': employeeNumber } };
    p.updateModule('archive', employee.id, patch, `组织关系调整 · ${fieldChanges(employee, patch)}`);
    p.update(department.id, {}, `${employee.title}（${employeeNumber}）组织关系调整 · ${fieldChanges(employee, patch)}`);
    p.notify(`已更新 ${employee.title} 的组织关系，员工档案同步显示。`);
    setEmployeeId('');
  }
  return <section className="hr-business-block"><h3>员工、岗位与汇报关系</h3><div className="hr-table-scroll"><table className="hr-table"><thead><tr><th>员工 / 人员编号</th><th>岗位 / 序列</th><th>直属上级 / 兼岗</th></tr></thead><tbody>{employees.map(person => <tr key={person.id}><td>{person.title}<small>{person.fields['人员编号'] || person.id} · {person.fields['公司主体'] || department.fields['公司主体']}</small></td><td>{person.fields['岗位'] || '待维护'}<small>{person.fields['岗位序列'] || '序列待维护'}</small></td><td>{person.fields['直属上级'] || '待维护'}<small>{person.fields['兼岗信息'] || '未登记兼岗'}</small><button className="hr-text-link" onClick={() => choose(person.id)}>调整关系</button></td></tr>)}</tbody></table></div>{!employees.length && <Notice>本部门暂无员工关系。可选择已有档案，将员工关联到本部门。</Notice>}
    <label className="hr-business-label">选择员工维护关系<NativeSelect aria-label="选择员工维护关系" value={employeeId} onChange={event => choose(event.target.value)}><option value="">请选择员工</option>{p.all.archive.map(person => <option value={person.id} key={person.id}>{person.title} · {person.fields['人员编号'] || person.id} · {person.dept}</option>)}</NativeSelect></label>
    {employee && <div className="hr-stack"><Notice>保存后所属部门为「{department.title}」。其他档案材料继续保留。</Notice><div className="hr-form-grid">{['公司主体', '岗位', '岗位序列', '直属上级', '兼岗信息'].map(field => <label key={field} className={field === '兼岗信息' ? 'hr-wide' : undefined}>{field}<Input aria-label={`员工${field}`} value={draft[field] || ''} placeholder={field === '兼岗信息' ? '例如：兼任验证负责人；无兼岗可填“无”' : ''} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}</div>{error && <p className="hr-error" role="alert">{error}</p>}<div className="hr-actions"><Button onClick={save}>保存组织关系</Button></div></div>}
  </section>;
}

export function OrganizationView({ p }: { p: HrProps }) {
  const enhanced = withBusinessFields(p, []);
  return <><section className="hr-panel hr-org"><HorizonSectionHeader title="公司与部门组织结构" description="上级部门变更后自动重排；员工关系与档案同步，操作记录保留前后差异。" /><div className="hr-org-root">壹诺吉 · 总经办</div><ul className="hr-department-tree">{buildOrgTree(p.rows).map(node => <DepartmentBranch key={node.row.id} node={node} />)}</ul>{!p.rows.length && <Notice>尚未建立部门，请通过下方新建入口添加。</Notice>}</section><Desk p={enhanced}>{row => <><Facts row={row} fields={p.module.fields} /><BusinessFields p={p}><EmployeeRelations key={row.id} p={enhanced} department={row} /></BusinessFields></>}</Desk></>;
}

function channelDefaults(row: HrRecord) {
  const sequence = row.fields['岗位序列'] || '未定义序列';
  const preset: Record<string, [string, string]> = {
    技术研发: ['助理工程师 → 研发工程师 → 高级研发工程师 → 技术专家', '研发组长 → 研发经理 → 研发总监'],
    质量管理: ['质量专员 → 质量工程师 → 高级质量工程师 → 质量专家', '质量组长 → 质量主管 → 质量经理'],
    生产运营: ['生产技术员 → 工艺工程师 → 高级工艺工程师 → 制造专家', '班组长 → 生产主管 → 生产经理'],
  };
  return { professional: row.fields['专业通道'] || preset[sequence]?.[0] || row.fields['发展通道'] || '', management: row.fields['管理通道'] || preset[sequence]?.[1] || '' };
}

function CareerSteps({ label, value, row }: { label: string; value: string; row: HrRecord }) {
  const levels = value.split(/→|\n/).map(step => step.trim()).filter(Boolean);
  return <div className="hr-business-block"><h3>{label}</h3>{levels.length ? <ol className="hr-career-steps">{levels.map((level, index) => <li key={`${level}-${index}`} data-current={level === row.title}><small>{label === '专业通道' ? 'P' : 'M'}{index + 1}</small><strong>{level}</strong>{level === row.title && <Badge>当前岗位</Badge>}</li>)}</ol> : <Notice>本序列尚未维护{label}，可在下方编辑后保存。</Notice>}</div>;
}

function PositionDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const defaults = channelDefaults(row);
  const [professional, setProfessional] = useState(defaults.professional);
  const [management, setManagement] = useState(defaults.management);
  const [error, setError] = useState('');
  return <><Facts row={row} fields={['岗位序列', '职级', '专业等级', '发展通道']} /><div className="hr-position-focus"><small>{row.fields['岗位序列']}序列</small><h3>{row.title}</h3><Badge>{row.fields['职级']} · {row.fields['专业等级']}</Badge></div><CareerSteps label="专业通道" value={defaults.professional} row={row} /><CareerSteps label="管理通道" value={defaults.management} row={row} />{(!row.fields['专业通道'] || !row.fields['管理通道']) && <Notice>未单独维护的通道显示该序列演示草案；保存后成为本岗位通道。P/M 为路径节点示意，以维护的实际职级为准。</Notice>}<details className="hr-business-edit"><summary>编辑双通道</summary><div className="hr-stack"><label>专业通道（用 → 分隔）<Textarea value={professional} onChange={event => setProfessional(event.target.value)} /></label><label>管理通道（用 → 分隔）<Textarea value={management} onChange={event => setManagement(event.target.value)} /></label>{error && <p role="alert" className="hr-error">{error}</p>}<Button onClick={() => { if (!professional.trim() || !management.trim()) { setError('请填写专业与管理两个通道。'); return; } p.update(row.id, { fields: { ...row.fields, '专业通道': professional, '管理通道': management } }, '保存岗位双通道'); setError(''); }}>保存双通道</Button></div></details></>;
}

export function PositionView({ p }: { p: HrProps }) {
  const enhanced = withBusinessFields(p, []);
  const sequences = [...new Set(p.rows.map(row => row.fields['岗位序列']).filter(Boolean))];
  const [sequence, setSequence] = useState('全部序列');
  const rows = p.rows.filter(row => sequence === '全部序列' || row.fields['岗位序列'] === sequence);
  return <><section className="hr-panel hr-org"><HorizonSectionHeader title="岗位序列与分级结构" description="岗位按序列归组，右侧所选岗位展示各自的专业与管理发展通道。" /><div className="hr-position-groups">{sequences.map(name => <section key={name}><h3>{name}</h3>{p.rows.filter(row => row.fields['岗位序列'] === name).map(row => <div key={row.id}><strong>{row.title}</strong><small>{row.fields['职级']} · {row.fields['专业等级']} · {row.dept}</small></div>)}</section>)}</div></section><Desk p={{ ...enhanced, rows }} onRecordSaved={() => setSequence('全部序列')} tools={<Select label="岗位序列筛选" value={sequence} onChange={setSequence} options={['全部序列', ...sequences]} />}>{row => <BusinessFields p={p}><PositionDetail key={`${row.id}-${row.fields['岗位序列']}-${row.fields['专业通道'] || ''}-${row.fields['管理通道'] || ''}`} p={enhanced} row={row} /></BusinessFields>}</Desk></>;
}

type Competency = { id: string; name: string; definition: string; weight: number; levels: string[] };
const levels = ['初级', '中级', '高级', '专家'];
function initialCompetencies(row: HrRecord): Competency[] {
  try { const saved = JSON.parse(row.fields['胜任力模型'] || 'null'); if (Array.isArray(saved)) return saved; } catch { /* Display a transparent editable draft for existing text definitions. */ }
  const names = (row.fields['能力要求'] || '专业能力、协作沟通、风险识别').split(/[、，,\n]/).filter(Boolean);
  return names.map((name, index) => ({ id: `C${index + 1}`, name, definition: `在${row.fields['岗位序列'] || '本'}序列工作中，运用${name}完成职责并形成可验证产出。`, weight: index === names.length - 1 ? 100 - Math.floor(100 / names.length) * (names.length - 1) : Math.floor(100 / names.length), levels: [`在指导下按标准完成${name}相关任务，能记录执行结果。`, `独立完成${name}相关任务，识别常见问题并提出改进。`, `处理复杂情境，组织跨团队协作并辅导他人。`, `建立方法标准，解决系统性问题并评估组织影响。`] }));
}

function CompetencyDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const [model, setModel] = useState<Competency[]>(() => initialCompetencies(row));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [document, setDocument] = useState<Record<string, string>>({ '岗位目的': row.fields['岗位目的'] || `承担${row.fields['岗位序列']}序列职责，支持部门目标达成。`, '任职资格': row.fields['任职资格'] || row.fields['能力要求'] || '', '汇报关系': row.fields['汇报关系'] || '直属部门负责人', '协作接口': row.fields['协作接口'] || row.fields['可兼任角色'] || '', '成果与验收': row.fields['成果与验收'] || '按经确认的任务目标、质量与交付标准验收。', '说明书版本': row.fields['说明书版本'] || '演示草案 v1', '说明书生效日': row.fields['说明书生效日'] || '2026-10-09' });
  const total = model.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const setItem = (id: string, patch: Partial<Competency>) => setModel(model.map(item => item.id === id ? { ...item, ...patch } : item));
  function save() {
    if (!canManageModule(p.module.id, p.role)) { setError('当前演示角色仅可查看胜任力模型。'); return; }
    if (!model.length || total !== 100 || model.some(item => !item.name.trim() || !item.definition.trim() || !(item.weight > 0 && item.weight <= 100) || item.levels.some(level => !level.trim()))) { setError('请完整填写能力定义、四级行为标准；各权重必须大于 0，合计为 100%。'); return; }
    if (Object.values(document).some(value => !value.trim())) { setError('请完整填写标准岗位说明书。'); return; }
    p.update(row.id, { fields: { ...row.fields, ...document, '胜任力模型': JSON.stringify(model) } }, `保存岗位说明书与 ${model.length} 项胜任力模型（权重合计 100%）`);
    setEditing(false); setError('');
  }
  const docText = `${row.title}\n岗位序列：${row.fields['岗位序列']}\n核心职责：${row.fields['核心职责']}\n${Object.entries(document).map(([key, value]) => `${key}：${value}`).join('\n')}\n\n胜任力模型\n${model.map(item => `${item.name}（${item.weight}%）\n定义：${item.definition}\n${item.levels.map((level, index) => `${levels[index]}：${level}`).join('\n')}`).join('\n\n')}`;
  return <><div className="hr-actions"><Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>{editing ? '收起编辑' : '编辑说明书与模型'}</Button><Button variant="outline" size="sm" onClick={() => download(`${row.title}-岗位说明书.txt`, docText, 'text/plain;charset=utf-8')}>导出说明书</Button></div><section className="hr-business-block"><h3>标准岗位说明书</h3><Facts row={row} fields={['岗位序列', '核心职责', '可兼任角色']} /><dl className={`hr-facts hr-competency-document${editing ? ' is-editing' : ''}`}>{Object.entries(document).map(([key, value]) => {
    const multiline = ['岗位目的', '任职资格', '协作接口', '成果与验收'].includes(key);
    return <div key={key} className={multiline ? 'hr-competency-document-long' : undefined}><dt>{key}</dt><dd>{editing ? multiline
      ? <Textarea aria-label={key} rows={3} value={value} onChange={event => setDocument({ ...document, [key]: event.target.value })} />
      : <Input aria-label={key} type={key === '说明书生效日' ? 'date' : 'text'} value={value} onChange={event => setDocument({ ...document, [key]: event.target.value })} />
      : value}</dd></div>;
  })}</dl></section>{!row.fields['胜任力模型'] && <Notice>以下为可编辑演示草案，依据现有能力名称展开；尚未作为正式任职标准审批。</Notice>}<section className="hr-business-block"><h3>胜任力模型 <Badge>权重合计 {total}%</Badge></h3>{model.map((item, index) => <article className="hr-competency" key={item.id}><div className="hr-competency-heading"><strong>{index + 1}. {item.name}</strong><Badge>{item.weight}%</Badge></div>{editing ? <><div className="hr-form-grid"><label>能力名称<Input aria-label={`能力${index + 1}名称`} value={item.name} onChange={event => setItem(item.id, { name: event.target.value })} /></label><label>权重（%）<Input aria-label={`能力${index + 1}权重`} type="number" min="1" max="100" value={item.weight} onChange={event => setItem(item.id, { weight: Number(event.target.value) })} /></label></div><label>能力定义<Textarea value={item.definition} onChange={event => setItem(item.id, { definition: event.target.value })} /></label></> : <p>{item.definition}</p>}<ol className="hr-behavior-levels">{item.levels.map((level, levelIndex) => <li key={levelIndex}><strong>{levels[levelIndex]}</strong>{editing ? <Textarea aria-label={`${item.name}${levels[levelIndex]}行为标准`} value={level} onChange={event => setItem(item.id, { levels: item.levels.map((value, valueIndex) => valueIndex === levelIndex ? event.target.value : value) })} /> : <span>{level}</span>}</li>)}</ol>{editing && <Button variant="outline" size="sm" disabled={model.length <= 1} onClick={() => setModel(model.filter(value => value.id !== item.id))}>移除此能力</Button>}</article>)}</section>{editing && <><div className="hr-actions"><Button variant="outline" onClick={() => setModel([...model, { id: `C-${crypto.randomUUID()}`, name: '', definition: '', weight: 0, levels: ['', '', '', ''] }])}>添加能力项</Button><Button onClick={save}>保存说明书与模型</Button></div>{error && <p role="alert" className="hr-error">{error}</p>}</>}</>;
}

export function CompetencyView({ p }: { p: HrProps }) {
  const enhanced = withBusinessFields(p, []);
  return <div className="hr-business-full-detail hr-competency-view"><Desk p={enhanced}>{row => <BusinessFields p={p}><CompetencyDetail key={`${row.id}-${row.fields['岗位序列']}-${row.fields['能力要求']}`} p={enhanced} row={row} /></BusinessFields>}</Desk></div>;
}
