import { NativeSelect } from '../components/ui/native-select';
import React, { useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { HorizonSectionHeader } from '../components/horizon/HorizonPage';
import type { HrProps, HrRecord } from '../../mocks/hrPreview';
import { Attachment, Badge, Desk, Facts, Notice, copySessionAttachment } from './WorkViews';
import { canStartRoom, expenseDifference, fieldChanges, meetingActionError, meetingExportData, meetingSyncError, meetingSyncPlan, nonnegativeNumber, readMeetingActions, roomBookingState, roomUsageEndError, type MeetingAction } from './businessLogic';
import { BusinessFields, withBusinessFields } from './OrganizationBusinessViews';

type AssetTransfer = { operation: string; time: string; sender: string; recipient: string; fromDept: string; toDept: string; fromPlace: string; toPlace: string; condition: string; reason: string; operator: string };
function storedArray<T>(value: string | undefined): T[] { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }

function AssetDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const purchaseFields = ['采购申请', '采购申请人', '采购申请日期', '采购供应商', '采购金额', '采购审批结果', '采购用途'];
  const [purchase, setPurchase] = useState<Record<string, string>>(() => Object.fromEntries(purchaseFields.map(field => [field, row.fields[field] || (field === '采购用途' ? row.fields['采购事由'] : field === '采购审批结果' ? row.fields['采购审批状态'] : '') || ''])));
  const [person, setPerson] = useState('');
  const [department, setDepartment] = useState(row.dept);
  const [place, setPlace] = useState('');
  const [condition, setCondition] = useState('完好');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const transfers = storedArray<AssetTransfer>(row.fields['交接明细']);
  function savePurchase() {
    if (purchaseFields.some(field => !purchase[field]?.trim()) || nonnegativeNumber(purchase['采购金额']) === null) { setPurchaseError('请完整填写采购申请信息，金额必须为非负数。'); return; }
    p.update(row.id, { fields: { ...row.fields, ...purchase } }, '补全采购来源'); setPurchaseError('');
  }
  function transfer(operation: string) {
    const isReturn = operation === '归还';
    const isStock = operation === '入库';
    if (isStock && (!row.fields['采购申请'] || !row.fields['采购申请人'] || !row.fields['采购申请日期'])) { setError('请先补全并保存采购来源，再确认入库。'); return; }
    if (!reason.trim() || !condition.trim() || (!isReturn && (!person.trim() || !place.trim() || !department.trim()))) { setError('请填写接收人、接收部门、位置、设备状况和交接事由。'); return; }
    const to = isReturn ? '行政保管员' : person.trim();
    const toDept = isReturn ? '人事行政部' : department.trim();
    const toPlace = isReturn ? '行政库房' : place.trim();
    const next: AssetTransfer = { operation, time: new Date().toLocaleString('zh-CN', { hour12: false }), sender: isStock ? row.fields['采购供应商'] || '采购经办人' : row.fields['使用人'] && row.fields['使用人'] !== '未领用' ? row.fields['使用人'] : row.owner, recipient: to, fromDept: row.dept, toDept, fromPlace: row.fields['存放位置'] || '待登记', toPlace, condition, reason, operator: `${p.role} · 演示操作` };
    p.update(row.id, { status: isStock ? '在库' : isReturn ? '已归还' : '使用中', owner: to, dept: toDept, fields: { ...row.fields, '使用人': isStock || isReturn ? '未领用' : to, '存放位置': toPlace, '设备状况': condition, '交接明细': JSON.stringify([...transfers, next]) } }, `${operation}交接 · ${next.sender} → ${to}；${next.fromPlace} → ${toPlace}；事由：${reason}`);
    setPerson(''); setPlace(''); setReason(''); setError('');
  }
  return <><Facts row={row} fields={['资产编码', '资产类型', '存放位置', '使用人', '设备状况']} /><section className="hr-business-block"><h3>采购来源 · {row.fields['采购申请'] || '尚未关联申请'}</h3><Facts row={row} fields={purchaseFields} /><details className="hr-business-edit"><summary>查看／补全采购申请</summary><div className="hr-stack"><div className="hr-form-grid">{purchaseFields.map(field => <label key={field} className={field === '采购用途' ? 'hr-wide' : undefined}>{field}<Input aria-label={field} type={field.includes('日期') ? 'date' : field.includes('金额') ? 'number' : 'text'} min={field.includes('金额') ? '0' : undefined} value={purchase[field]} onChange={event => setPurchase({ ...purchase, [field]: event.target.value })} /></label>)}</div>{purchaseError && <p className="hr-error" role="alert">{purchaseError}</p>}<div className="hr-actions"><Button variant="outline" onClick={savePurchase}>保存采购来源</Button></div></div></details><Notice>此处为采购来源台账，可按申请编号追溯；真实采购审批系统尚未连接。</Notice></section>
    <section className="hr-business-block"><h3>{row.status === '待入库' ? '资产入库' : '资产交接'}</h3><div className="hr-form-grid"><label>接收人<Input aria-label="资产接收人" value={person} onChange={event => setPerson(event.target.value)} /></label><label>接收部门<Input aria-label="资产接收部门" value={department} onChange={event => setDepartment(event.target.value)} /></label><label>接收位置<Input aria-label="资产接收位置" value={place} onChange={event => setPlace(event.target.value)} /></label><label>设备状况<Input aria-label="设备状况" value={condition} onChange={event => setCondition(event.target.value)} /></label><label className="hr-wide">交接事由<Textarea aria-label="交接事由" value={reason} onChange={event => setReason(event.target.value)} /></label></div>{error && <p className="hr-error" role="alert">{error}</p>}<div className="hr-actions">{row.status === '待入库' ? <Button onClick={() => transfer('入库')}>确认入库</Button> : <><Button onClick={() => transfer(row.status === '使用中' ? '调拨' : '领用')}>{row.status === '使用中' ? '确认调拨' : '确认领用'}</Button><Button variant="outline" disabled={row.status !== '使用中'} onClick={() => transfer('归还')}>归还行政库房</Button></>}</div><small className="hr-subtle">归还时接收人和位置自动使用行政库房资料，仍需填写状况与事由。</small></section>
    <section className="hr-business-block"><h3>完整交接台账</h3>{!transfers.length ? <Notice>暂无本次演示交接记录。现有资产仅有当前状态，历史单据待补录；完成一次领用、调拨或归还后将显示详细记录。</Notice> : <ol className="hr-transfer-list">{transfers.map((entry, index) => <li key={`${entry.time}-${index}`}><strong>{entry.operation} · {entry.time}</strong><p>{entry.sender} → {entry.recipient}</p><p>{entry.fromDept} / {entry.fromPlace} → {entry.toDept} / {entry.toPlace}</p><small>状况：{entry.condition} · 事由：{entry.reason}<br />操作人：{entry.operator}</small></li>)}</ol>}</section></>;
}

export function AssetView({ p }: { p: HrProps }) {
  const enhanced = withBusinessFields(p, ['采购申请人', '采购申请日期', '采购供应商', '采购金额', '采购用途', '采购审批结果']);
  return <Desk p={enhanced}>{row => <BusinessFields p={p}><AssetDetail key={`${row.id}-${row.fields['采购申请'] || ''}`} p={enhanced} row={row} /></BusinessFields>}</Desk>;
}

const invoiceFields = ['发票号码', '发票日期', '发票金额', '发票销售方', '发票购买方'];
const voucherFields = ['凭证编号', '付款日期', '凭证金额', '付款方', '收款方'];
function ExpenseDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const [draft, setDraft] = useState({ ...row.fields });
  const [error, setError] = useState('');
  const [choice, setChoice] = useState('');
  const [original] = useState<Record<string, string>>(() => { try { return JSON.parse(row.fields['识别原值'] || 'null') || { ...row.fields }; } catch { return { ...row.fields }; } });
  const difference = expenseDifference(draft);
  const changed = [...invoiceFields, ...voucherFields, '报销金额', '人工复核意见'].some(field => (draft[field] || '') !== (row.fields[field] || ''));
  function patch(field: string, value: string) { setDraft(current => ({ ...current, [field]: value })); }
  function attach(kind: '发票' | '付款凭证', name: string) {
    const next = { ...draft, [`${kind}材料`]: name, '关联状态': '待重新确认' };
    setDraft(next);
    p.update(row.id, { status: '待复核', fields: { ...row.fields, [`${kind}材料`]: name, '关联状态': '待重新确认' } }, `更换${kind}材料，撤销原复核确认`);
  }
  function save() {
    if (['报销金额', '发票金额', '凭证金额'].some(field => nonnegativeNumber(draft[field]) === null)) { setError('请填写有效的发票、凭证和报销金额，不能留空或小于零。'); return false; }
    if (!draft['发票号码']?.trim() || !draft['凭证编号']?.trim()) { setError('请填写发票号码和付款凭证编号。'); return false; }
    const next = { ...row.fields, ...draft, '识别原值': JSON.stringify(original), '关联状态': '待重新确认' };
    p.update(row.id, { status: '待复核', fields: next }, `保存人工修正 · ${fieldChanges(row, { fields: next })}`);
    setDraft(next); setError(''); return true;
  }
  function reassociate() {
    const source = p.rows.find(candidate => candidate.id === choice);
    if (!source) { setError('请先选择需要关联的付款凭证。'); return; }
    const attachmentKey = `expense:${row.id}:voucher:${crypto.randomUUID()}`;
    const copied = copySessionAttachment(source.fields['凭证附件键'] || `expense:${source.id}:voucher`, attachmentKey);
    const voucherPatch = { ...Object.fromEntries(voucherFields.map(field => [field, source.fields[field] || (field === '凭证编号' ? source.id : '')])), '付款凭证材料': copied ? source.fields['付款凭证材料'] || '已关联本地材料' : '', '凭证附件键': attachmentKey, '关联凭证记录': source.id, '关联状态': '待重新确认' };
    setDraft(current => ({ ...current, ...voucherPatch }));
    p.update(row.id, { status: '待复核', fields: voucherPatch }, `重新关联付款凭证 ${source.id}，需再次人工确认`); setError('');
  }
  function confirm() {
    if (changed) { setError('当前字段有未保存修正，请先保存，再确认关联。'); return; }
    if (!draft['发票材料'] || !draft['付款凭证材料']) { setError('请分别选择发票与付款凭证材料后再确认。'); return; }
    if (difference === null || nonnegativeNumber(draft['报销金额']) === null || !draft['凭证编号']?.trim() || !draft['发票号码']?.trim() || !draft['人工复核意见']?.trim()) { setError('请补全单据编号、三类金额及人工复核意见。'); return; }
    const next = { ...row.fields, ...draft, '关联状态': '已确认', '确认差异': `${difference.toFixed(2)} 元`, '关联发票号码': draft['发票号码'], '关联凭证编号': draft['凭证编号'] };
    p.update(row.id, { status: '已确认', fields: next }, `确认发票 ${draft['发票号码']} ↔ 凭证 ${draft['凭证编号']}；差异 ${difference.toFixed(2)} 元；${draft['人工复核意见']}`);
    setDraft(next); setError('');
  }
  function DocumentFields({ title, fields }: { title: string; fields: string[] }) {
    const attachmentKey = title === '发票' ? `expense:${row.id}:invoice` : draft['凭证附件键'] || `expense:${row.id}:voucher`;
    return <section className="hr-expense-document"><h3>{title}</h3><Attachment key={attachmentKey} label={`选择${title}材料`} storageKey={attachmentKey} accept=".pdf,.png,.jpg,.jpeg" onChange={name => attach(title === '发票' ? '发票' : '付款凭证', name)} /><small className="hr-subtle">已登记：{draft[`${title}材料`] || '未选择材料'}</small>{fields.map(field => <label key={field}>{field}<Input aria-label={field} type={field.includes('金额') ? 'number' : field.includes('日期') ? 'date' : 'text'} min={field.includes('金额') ? '0' : undefined} step={field.includes('金额') ? '0.01' : undefined} value={draft[field] || ''} onChange={event => patch(field, event.target.value)} /><small className="hr-subtle">原始样例值：{original[field] || '未提供'}</small></label>)}</section>;
  }
  // Keep input subtrees stable while typing; document rendering is called as a function, not mounted as a new component.
  return <><Notice>双材料仅本地预览。下方为样例提取字段及人工修正；真实 OCR 未接入，发票金额缺失时必须手动补录。</Notice><div className="hr-expense-documents">{DocumentFields({ title: '发票', fields: invoiceFields })}{DocumentFields({ title: '付款凭证', fields: voucherFields })}</div><section className="hr-business-block"><h3>金额核对与材料关联</h3><div className="hr-expense-difference"><span>凭证金额 − 发票金额</span><strong>{difference === null ? '待补全金额' : `${difference.toFixed(2)} 元`}</strong><Badge>{difference === null ? '无法计算' : difference === 0 ? '金额一致' : '存在差异'}</Badge></div><label>报销金额（独立核对）<Input aria-label="报销金额（独立核对）" type="number" min="0" step="0.01" value={draft['报销金额'] || ''} onChange={event => patch('报销金额', event.target.value)} /></label><label>人工复核意见<Textarea aria-label="费用人工复核意见" value={draft['人工复核意见'] || ''} placeholder="说明差异、修正依据及可否确认" onChange={event => patch('人工复核意见', event.target.value)} /></label><div className="hr-actions"><Button variant="outline" onClick={save}>保存人工修正</Button><Button disabled={row.status === '已确认' && !changed} onClick={confirm}>确认材料关联与复核</Button></div><p className="hr-subtle">当前关联：{row.fields['关联发票号码'] || draft['发票号码'] || '无发票'} ↔ {row.fields['关联凭证编号'] || draft['凭证编号'] || '无凭证'} · {row.fields['关联状态'] || '待确认'}</p><details className="hr-business-edit"><summary>重新关联付款凭证</summary><label>选择本会话已有凭证<NativeSelect aria-label="重新关联付款凭证" value={choice} onChange={event => setChoice(event.target.value)}><option value="">请选择凭证记录</option>{p.rows.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.title} · {candidate.fields['凭证金额']} 元</option>)}</NativeSelect></label><Button variant="outline" onClick={reassociate}>替换关联并重新复核</Button></details>{error && <p role="alert" className="hr-error">{error}</p>}</section></>;
}

export function ExpenseView({ p }: { p: HrProps }) {
  return <div className="hr-business-full-detail"><Desk p={withBusinessFields(p, [...invoiceFields, ...voucherFields])} allowEdit={false}>{row => <ExpenseDetail key={row.id} p={p} row={row} />}</Desk></div>;
}

const roomNames = ['大会议室', '电影院（报告厅）', '小会议室·老板办旁', '小会议室·研发对面'];
function RoomDetail({ p, row, now }: { p: HrProps; row: HrRecord; now: string }) {
  const [error, setError] = useState('');
  const state = roomBookingState(row, now);
  function finish(cancel: boolean) {
    if (row.status === '已取消' || (!cancel && (!row.fields['使用开始'] || row.fields['使用结束']))) return;
    const issue = roomUsageEndError(row, now);
    if (issue) { setError(issue); return; }
    const endFields = row.fields['使用开始'] && !row.fields['使用结束'] ? { '使用结束': now } : {};
    p.update(row.id, { ...(cancel ? { status: '已取消' } : {}), fields: endFields }, cancel ? '取消预约并释放时段' : '登记结束使用；预约时段仍保留，取消预约可释放时段');
    setError('');
  }
  return <><Facts row={row} fields={p.module.fields} /><div className="hr-door"><CalendarDays size={24} /><strong>{row.fields['会议室']}</strong><Badge>{row.status === '已取消' ? '已取消' : state}</Badge><span>{row.date} {row.fields['开始时间']}–{row.fields['结束时间']}</span><h3>{row.title}</h3><small>门牌设备预览 · 尚未连接实际设备</small></div><div className="hr-actions"><Button disabled={!canStartRoom(row, now)} onClick={() => { if (!canStartRoom(row, now)) { setError('仅已预约且处于预约时段的会议可以开始使用。'); return; } p.update(row.id, { fields: { ...row.fields, '使用开始': now } }, '预约人登记开始使用会议室'); }}>开始使用</Button><Button variant="outline" disabled={!row.fields['使用开始'] || Boolean(row.fields['使用结束']) || row.status === '已取消'} onClick={() => finish(false)}>结束使用</Button><Button variant="outline" disabled={row.status === '已取消'} onClick={() => finish(true)}>取消本次预约</Button></div>{!canStartRoom(row, now) && <Notice>{row.fields['使用开始'] ? `已登记使用：${row.fields['使用开始']}${row.fields['使用结束'] ? `，结束：${row.fields['使用结束']}` : ''}` : '未到预约时间、已结束或已取消时，禁止开始使用。请在顶部调整演示时间查看不同房态。'}</Notice>}{error && <p role="alert" className="hr-error">{error}</p>}</>;
}

export function RoomView({ p }: { p: HrProps }) {
  const [now, setNow] = useState('2026-10-16T13:45');
  const date = now.slice(0, 10);
  const [room, setRoom] = useState('全部会议室');
  return <><section className="hr-panel hr-room-overview"><HorizonSectionHeader title="全部会议室 · 时段与门牌总览" description="房态按演示时钟计算；未预约不能使用，取消后释放预约时段。" /><div className="hr-toolbar"><label className="hr-business-label">演示时间<Input aria-label="演示时间" type="datetime-local" value={now} onChange={event => { if (event.target.value) setNow(event.target.value); }} /></label><Badge>4 间会议室</Badge></div><div className="hr-room-cards">{roomNames.map(name => {
    const bookings = p.rows.filter(row => row.fields['会议室'] === name && row.date === date && row.status !== '已取消').sort((a, b) => a.fields['开始时间'].localeCompare(b.fields['开始时间']));
    const current = bookings.find(row => roomBookingState(row, now) === '会议中') || bookings.find(row => roomBookingState(row, now) === '即将开始') || bookings.at(-1);
    const state = roomBookingState(current, now);
    return <article key={name}><div><h3>{name}</h3><Badge>{state}</Badge></div><p>{current ? current.title : '当前日期暂无预约'}</p><small>{current ? `${current.fields['开始时间']}–${current.fields['结束时间']} · ${current.owner}` : '先新建预约，再登记使用'}</small><div className="hr-actions"><Button size="sm" variant="outline" onClick={() => setRoom(name)}>查看预约</Button><Button size="sm" disabled={!canStartRoom(current, now)} onClick={() => { if (current && canStartRoom(current, now)) p.update(current.id, { fields: { ...current.fields, '使用开始': now } }, `${name}登记开始使用`); }}>开始使用</Button></div></article>;
  })}</div><div className="hr-table-scroll"><table className="hr-table hr-room-timetable"><thead><tr><th>会议室 / {date}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{String(i + 8).padStart(2, '0')}:00</th>)}</tr></thead><tbody>{roomNames.map(name => <tr key={name}><th>{name}</th>{Array.from({ length: 12 }, (_, i) => {
    const start = `${String(i + 8).padStart(2, '0')}:00`, end = `${String(i + 9).padStart(2, '0')}:00`;
    const bookings = p.rows.filter(row => row.fields['会议室'] === name && row.date === date && row.status !== '已取消' && row.fields['开始时间'] < end && row.fields['结束时间'] > start);
    return <td key={i}>{bookings.map(booking => <span className="hr-room-booked" title={`${booking.title} ${booking.fields['开始时间']}–${booking.fields['结束时间']}`} key={booking.id}>{booking.title}</span>)}</td>;
  })}</tr>)}</tbody></table></div><small className="hr-subtle">左右滚动查看完整时段。总览显示 08:00–20:00；完整起止时间请查看下方预约明细。</small></section><Desk p={{ ...p, rows: p.rows.filter(row => room === '全部会议室' || row.fields['会议室'] === room) }} onRecordSaved={() => setRoom('全部会议室')} tools={<label className="hr-select-label"><NativeSelect aria-label="会议室筛选" value={room} onChange={event => setRoom(event.target.value)}>{['全部会议室', ...roomNames].map(name => <option key={name}>{name}</option>)}</NativeSelect></label>}>{row => <RoomDetail key={row.id} p={p} row={row} now={now} />}</Desk></>;
}

function MeetingDetail({ p, row }: { p: HrProps; row: HrRecord }) {
  const [actions, setActions] = useState<MeetingAction[]>(() => readMeetingActions(row));
  const [conclusion, setConclusion] = useState(row.fields['会议结论'] || '');
  const [error, setError] = useState('');
  const stored = readMeetingActions(row);
  const dirty = JSON.stringify(actions) !== JSON.stringify(stored) || conclusion !== row.fields['会议结论'];
  const update = (id: string, patch: Partial<MeetingAction>) => setActions(actions.map(action => action.id === id ? { ...action, ...patch } : action));
  function validate() { const message = meetingActionError(actions, row.fields['会议日期'] || row.date); if (message || !conclusion.trim()) { setError(message || '请填写会议结论。'); return false; } setError(''); return true; }
  function fields(next: MeetingAction[]) { return { ...row.fields, '会议结论': conclusion, '行动项': next.map(action => action.title).join('\n'), '行动项明细': JSON.stringify(next) }; }
  function save() { if (!validate()) return; p.update(row.id, { status: actions.some(action => action.taskId) ? '已转任务' : '已整理', fields: fields(actions) }, '保存会议结论及逐项负责人、截止日期'); }
  function sync() {
    if (!validate()) return;
    const syncError = meetingSyncError(row.id, actions, p.all.tasks, row.fields['会议日期'] || row.date);
    if (syncError) { setError(syncError); return; }
    let created = 0, updated = 0;
    const next = meetingSyncPlan(row.id, actions, p.all.tasks).map(({ action, task }) => {
      const taskFields = { ...(task?.fields || {}), '任务类型': '专项项目', '开始日期': task?.fields['开始日期'] || row.fields['会议日期'] || row.date, '循环周期': task?.fields['循环周期'] || '不重复', '验收标准': conclusion, '来源纪要': row.id, '来源行动编号': action.id };
      if (task) {
        if (task.title !== action.title || task.owner !== action.owner || task.date !== action.deadline || task.fields['验收标准'] !== conclusion) { p.updateModule('tasks', task.id, { title: action.title, owner: action.owner, date: action.deadline, fields: taskFields }, `纪要 ${row.id} 更新行动项 ${action.id}，保留当前任务进度`); updated++; }
        return { ...action, taskId: task.id };
      }
      const taskId = p.add('tasks', { title: action.title, dept: row.dept, owner: action.owner, status: '待开始', date: action.deadline, detail: `来源纪要 ${row.id} / 行动 ${action.id}`, fields: taskFields }); created++;
      return { ...action, taskId };
    });
    setActions(next);
    p.update(row.id, { status: '已转任务', fields: fields(next) }, `增量同步行动项：新增 ${created} 项、更新 ${updated} 项，已有任务不重复创建`);
    p.notify(`行动项已同步：新增 ${created} 项，更新 ${updated} 项。`);
  }
  return <><Facts row={row} fields={['会议日期']} /><Attachment label="选择会议录音" storageKey={`meeting:${row.id}:recording`} accept=".mp3,.wav,.m4a" onChange={name => p.update(row.id, { fields: { ...row.fields, '本次录音': name } }, '本地选择录音材料')} /><Notice>录音转写、自动总结和历史服务尚未接入。手动维护结论后，每项行动可独立分配并同步到项目管理。</Notice><label>会议结论<Textarea aria-label="纪要会议结论" rows={3} value={conclusion} onChange={event => setConclusion(event.target.value)} /></label><section className="hr-business-block"><h3>行动项与任务跟进</h3>{actions.map((action, index) => {
    const task = meetingSyncPlan(row.id, [action], p.all.tasks)[0]?.task;
    return <article className="hr-meeting-action" key={action.id}><div className="hr-competency-heading"><strong>行动项 {index + 1}</strong><Badge>{task?.status || '未转任务'}</Badge></div><label>行动内容<Textarea aria-label={`行动项${index + 1}内容`} value={action.title} onChange={event => update(action.id, { title: event.target.value })} /></label><div className="hr-form-grid"><label>负责人<Input aria-label={`行动项${index + 1}负责人`} value={action.owner} onChange={event => update(action.id, { owner: event.target.value })} /></label><label>截止日期<Input aria-label={`行动项${index + 1}截止日期`} type="date" min={row.fields['会议日期'] || row.date} value={action.deadline} onChange={event => update(action.id, { deadline: event.target.value })} /></label></div>{task ? <><p className="hr-subtle">关联任务：{task.id} · 当前负责人 {task.owner} · 截止 {task.date}</p><progress aria-label={`${action.title}任务进度`} value={{ 待开始: 0, 进行中: 40, 待验收: 80, 已完成: 100 }[task.status] ?? 0} max="100" /><small className="hr-subtle">进度由项目管理状态回显。修改后同步会更新原任务并保留其状态。</small></> : <Button variant="outline" size="sm" onClick={() => setActions(actions.filter(value => value.id !== action.id))}>移除此未同步行动项</Button>}</article>;
  })}{!actions.length && <Notice>尚无行动项，可点击添加并填写负责人和截止日期。</Notice>}<Button variant="outline" onClick={() => setActions([...actions, { id: `${row.id}-${crypto.randomUUID()}`, title: '', owner: '', deadline: row.date }])}><Plus size={14} />添加行动项</Button></section>{error && <p className="hr-error" role="alert">{error}</p>}<div className="hr-actions"><Button variant="outline" onClick={save}>保存纪要与行动项</Button><Button onClick={sync}>保存并增量同步任务</Button></div>{dirty && <small className="hr-subtle">存在未保存内容；同步操作会同时保存，重复同步不会新增相同任务。</small>}<Link className="hr-text-link" to="/__preview/hr/tasks">查看项目管理中的关联任务</Link></>;
}

export function MeetingView({ p }: { p: HrProps }) {
  return <Desk p={p} allowEdit={false} exportData={rows => meetingExportData(rows, p.all.tasks)}>{row => <MeetingDetail key={row.id} p={p} row={row} />}</Desk>;
}
