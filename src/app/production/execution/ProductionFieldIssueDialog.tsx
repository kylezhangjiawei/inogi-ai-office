import './production-theme.css';
import { useEffect, useRef, useState } from 'react';
import { Camera, Paperclip, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { commandExecutionPlan, getExecutionOptions, listExecutionPlans, type ExecutionPlan, type ExecutionTask, type ExecutionUser } from '../../lib/productionExecutionApi';
import { getWarehouseFlows, type WarehouseIssue } from '../../lib/warehouseFlowApi';
import { uploadResourceFile } from '../../lib/resourceUpload';

type EvidenceFile = { fileId: string; name: string; type: string; preview: string };
const commonPhenomena = ['外观不良', '性能异常', '气密不合格', '装配干涉'];

export function ProductionFieldIssueDialog({ task, plan, onClose, onSaved }: { task: ExecutionTask; plan: ExecutionPlan; onClose: () => void; onSaved: () => void }) {
  const [current, setCurrent] = useState({ task, version: plan.version });
  const [submissionFailed, setSubmissionFailed] = useState(false), [reviewNote, setReviewNote] = useState('');
  const reports = current.task.reports.filter(row => row.quantity > row.goodQty && !current.task.fieldIssues?.some(item => item.reportId === row.id) && !current.task.inspections.some(item => item.reportId === row.id && item.qualityId));
  const [reportId, setReportId] = useState(reports[0]?.id || ''), [issue, setIssue] = useState(''), [evidence, setEvidence] = useState('');
  const [phenomena, setPhenomena] = useState([{ name: '', count: 1 }]), [files, setFiles] = useState<EvidenceFile[]>([]);
  const [initialCause, setInitialCause] = useState('unknown'), [department, setDepartment] = useState(''), [collaboratorId, setCollaboratorId] = useState('');
  const [collaborators, setCollaborators] = useState<ExecutionUser[]>([]), [peopleError, setPeopleError] = useState('');
  const [lines, setLines] = useState<WarehouseIssue['lines']>([]), [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false), [reload, setReload] = useState(0);
  const mounted = useRef(true), lock = useRef(false), upload = useRef<AbortController | null>(null), request = useRef<{ signature: string; id: string } | null>(null);
  const previews = useRef(new Set<string>()), camera = useRef<HTMLInputElement>(null), attachment = useRef<HTMLInputElement>(null), reviewRequest = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); reviewRequest.current?.abort(); previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current.clear(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadFailed(false); setError('');
    getWarehouseFlows(task.id, 'all', controller.signal).then(result => { if (!controller.signal.aborted) setLines(result.items.find(row => row.taskId === task.id)?.lines.filter(row => (row.signedQty || 0) > 0) || []); })
      .catch(cause => { if (!controller.signal.aborted) { setLoadFailed(true); setError(cause instanceof Error ? cause.message : '实领物料读取失败'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [task.id, reload]);
  useEffect(() => {
    const controller = new AbortController(); setPeopleError('');
    getExecutionOptions(controller.signal).then(options => { if (!controller.signal.aborted) setCollaborators(options.users.filter(person => person.canCollaborate)); })
      .catch(cause => { if (!controller.signal.aborted) setPeopleError(cause instanceof Error ? cause.message : '协同人员读取失败'); });
    return () => controller.abort();
  }, [reload]);
  const departments = [...new Set(collaborators.map(person => person.department || '__unknown__'))];
  const recipients = collaborators.filter(person => (person.department || '__unknown__') === department);
  const report = reports.find(row => row.id === reportId), defective = report ? Number((report.quantity - report.goodQty).toFixed(3)) : 0;
  const batch = plan.batches.find(row => row.id === task.batchId);
  const change = (callback: () => void) => { callback(); setDirty(true); if (!submissionFailed && !loadFailed) setError(''); };
  const close = () => { if (lock.current) return; if (dirty) setDiscard(true); else onClose(); };
  const quickSelect = (name: string) => change(() => {
    if (!issue.trim()) setIssue(name);
    setPhenomena(old => old.some(row => row.name === name) ? old : old.length === 1 && !old[0].name ? [{ name, count: 1 }] : [...old, { name, count: 1 }]);
  });
  async function uploadFiles(local: FileList | null) {
    if (!local?.length || lock.current) return;
    if (local.length + files.length > 20) { setError('最多上传 20 个证据附件'); return; }
    if (Array.from(local).some(file => file.size > 50 * 1024 * 1024)) { setError('单个附件不能超过 50 MB，请压缩后重新上传'); return; }
    lock.current = true; setBusy(true); setError(''); upload.current = new AbortController();
    try { for (const file of Array.from(local)) {
      const saved = await uploadResourceFile(file, 'assets', { signal: upload.current.signal });
      if (mounted.current) { const preview = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : ''; if (preview) previews.current.add(preview); setFiles(old => [...old, { fileId: saved.fileId, name: saved.fileName, type: file.type, preview }]); setDirty(true); }
    } } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '上传失败；已上传附件和填写内容已保留'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function removeFile(file: EvidenceFile) {
    change(() => { setFiles(old => old.filter(row => row.fileId !== file.fileId)); if (file.preview) { URL.revokeObjectURL(file.preview); previews.current.delete(file.preview); } });
  }
  async function reviewLatest() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setReviewNote('');
    const controller = new AbortController(); reviewRequest.current = controller;
    try {
      const [plans, warehouse] = await Promise.all([listExecutionPlans(plan.month, controller.signal), getWarehouseFlows(task.id, 'all', controller.signal)]);
      if (controller.signal.aborted) return;
      const latest = plans.find(row => row.id === plan.id), latestTask = latest?.tasks.find(row => row.id === task.id);
      if (!latest || !latestTask || latestTask.status !== 'dispatched') throw new Error('原任务已不可办理或当前无权查看，草稿保留，请核对原任务。');
      setCurrent({ task: latestTask, version: latest.version });
      setLines(warehouse.items.find(row => row.taskId === task.id)?.lines.filter(row => (row.signedQty || 0) > 0) || []);
      setSubmissionFailed(false);
      setReviewNote(latestTask.fieldIssues?.some(row => row.reportId === reportId) || latestTask.inspections.some(row => row.reportId === reportId && row.qualityId)
        ? '该次报工已登记异常，草稿已保留；请返回原任务，在原异常补充证据。'
        : '已重新核对报工和实领物料，填写内容与附件已保留。请核对数量和批次后再次提交。');
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '重新核对失败，草稿已保留'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function save() {
    if (lock.current || !report || loading || loadFailed) return;
    if (!issue.trim() || (!evidence.trim() && !files.length) || phenomena.some(row => !row.name.trim() || !Number.isSafeInteger(row.count) || row.count < 1)) { setError('请选择或填写现象及次数，并上传证据或填写现场说明'); return; }
    const recipient = recipients.find(person => person.id === collaboratorId);
    if (department && (!recipient || peopleError)) { setError('请选择该部门的建议接收人，或取消协同建议后直接提交不良'); return; }
    const data = { taskId: task.id, reportId, defectiveQty: defective, issue, initialCause, ...(department && recipient ? { requestedCollaboration: { department: recipient.department || null, ownerId: recipient.id } } : {}), reason: evidence.trim() || '现场证据见本单上传附件，待质量人员核验。', phenomena, fileIds: files.map(row => row.fileId), materialBatches: lines.map(row => ({ code: row.code, batchNo: selected[row.code] || null })) };
    const signature = JSON.stringify([current.version, data]); if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(''); setReviewNote(''); setSubmissionFailed(false);
    try { await commandExecutionPlan(plan.id, { action: 'field-issue', version: current.version, requestId: request.current.id, data }); if (mounted.current) onSaved(); }
    catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : '提交失败，草稿已保留'); setSubmissionFailed(true); } }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="production-ui-theme production-editor-dialog sm:max-w-3xl" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>登记现场不良</DialogTitle><DialogDescription>{task.name} · {task.line} · 生产单 {batch?.code || '待确认'}</DialogDescription></DialogHeader>
    <div className="production-editor-scroll">
      {loading ? <p role="status">读取实领物料…</p> : !reports.length ? <p className="text-sm text-muted-foreground">没有尚未关联异常的不良报工；请在原异常补充现象和证据。</p> : <fieldset disabled={busy} className="space-y-5">
        <div className="production-issue-context"><label className="grid gap-1 text-sm">对应报工<NativeSelect value={reportId} onChange={event => change(() => setReportId(event.target.value))}>{reports.map(row => <option key={row.id} value={row.id}>{row.date} · {row.quantity} {task.unit} · 不良 {Number((row.quantity - row.goodQty).toFixed(3))}</option>)}</NativeSelect></label><div><span>本次不良数量</span><strong>{defective} <small>{task.unit}</small></strong></div></div>
        <section className="space-y-3"><h3 className="text-sm font-semibold">选择不良现象</h3><div className="flex flex-wrap gap-2">{commonPhenomena.map(name => <Button key={name} type="button" size="sm" variant={phenomena.some(row => row.name === name) ? 'secondary' : 'outline'} aria-pressed={phenomena.some(row => row.name === name)} onClick={() => quickSelect(name)}>{name}</Button>)}</div>
          <label className="grid gap-1 text-sm">不良摘要<Input maxLength={2000} value={issue} placeholder="选择常用现象后自动带入，可补充" onChange={event => change(() => setIssue(event.target.value))} /></label>
          {phenomena.map((row, index) => <div className="production-phenomenon-row" key={index}><Input aria-label={`现场现象 ${index + 1}`} placeholder="现象名称" value={row.name} onChange={event => change(() => setPhenomena(old => old.map((item, i) => i === index ? { ...item, name: event.target.value } : item)))} /><label>次数<Input type="number" min="1" step="1" aria-label={`现场现象 ${index + 1} 次数`} value={row.count} onChange={event => change(() => setPhenomena(old => old.map((item, i) => i === index ? { ...item, count: Number(event.target.value) } : item)))} /></label>{phenomena.length > 1 && <Button size="icon" variant="ghost" aria-label={`移除现象 ${index + 1}`} onClick={() => change(() => setPhenomena(old => old.filter((_, i) => i !== index)))}><X className="size-4" aria-hidden="true" /></Button>}</div>)}
          <Button type="button" variant="ghost" size="sm" onClick={() => change(() => setPhenomena(old => [...old, { name: '', count: 1 }]))}>添加其他现象</Button><p className="production-note">同件多个现象分别填写次数，不重复增加不良件数。</p>
        </section>
        <section className="production-issue-assistance" aria-label="初步原因与协同建议"><h3>初步原因与协同建议</h3><div className="production-issue-assistance-fields">
          <label>初步原因（选填）<NativeSelect aria-label="初步原因（选填）" value={initialCause} onChange={event => change(() => setInitialCause(event.target.value))}><option value="unknown">待分析</option><option value="material">来料</option><option value="software">软件</option><option value="assembly">装配</option><option value="other">其他</option></NativeSelect></label>
          <label>建议协同部门（选填）<NativeSelect aria-label="建议协同部门（选填）" value={department} onChange={event => change(() => { setDepartment(event.target.value); setCollaboratorId(''); })}><option value="">暂不建议，交由负责人初判</option>{departments.map(value => <option key={value} value={value}>{value === '__unknown__' ? '未登记部门' : value}</option>)}</NativeSelect></label>
          {department && <label>建议接收人<NativeSelect aria-label="建议接收人" value={collaboratorId} onChange={event => change(() => setCollaboratorId(event.target.value))}><option value="">请选择接收人</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</NativeSelect></label>}
        </div><p className="production-note">提交后待负责人初判、分派。此处仅记录初步原因和协同建议，不代表已转交或原因已认定。</p>{peopleError && <p role="alert" className="text-sm text-destructive">{peopleError}<Button type="button" variant="link" size="sm" onClick={() => setReload(value => value + 1)}>重新读取人员</Button></p>}</section>
        <section className="space-y-3"><h3 className="text-sm font-semibold">现场照片与视频</h3><div className="production-evidence-actions"><Button type="button" variant="outline" onClick={() => camera.current?.click()}><Camera className="size-4" aria-hidden="true" />现场拍照</Button><Button type="button" variant="outline" onClick={() => attachment.current?.click()}><Paperclip className="size-4" aria-hidden="true" />选择照片、视频或附件</Button></div>
          <Input ref={camera} hidden type="file" accept="image/*" capture="environment" aria-label="现场拍照文件" onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }} /><Input ref={attachment} hidden type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf" aria-label="现场证据附件" onChange={event => { void uploadFiles(event.target.files); event.target.value = ''; }} />
          <p className="production-note">最多 20 个附件，单个不超过 50 MB。可上传证据后直接提交，现场说明按需补充。</p>
          {!!files.length && <ul className="production-evidence-files">{files.map(file => <li key={file.fileId}>{file.preview && (file.type.startsWith('video/') ? <video src={file.preview} controls preload="metadata" aria-label={file.name} /> : <img src={file.preview} alt={file.name} />)}<div><span>{file.name}</span><Button variant="ghost" size="icon" aria-label={`移除附件 ${file.name}`} onClick={() => removeFile(file)}><X className="size-4" aria-hidden="true" /></Button></div></li>)}</ul>}
          <label className="grid gap-1 text-sm">现场说明{files.length ? '（选填）' : '（无附件时必填）'}<Textarea rows={3} maxLength={2000} value={evidence} placeholder="发生情况、现场表现或需补充的信息" onChange={event => change(() => setEvidence(event.target.value))} /></label>
        </section>
        <details className="production-issue-materials"><summary>实际领用物料批次 · {lines.length} 种物料</summary><p className="my-2 production-note">来自本作业已签收物料；批号未查清可待补，不使用生产单号代替来料批次。</p>{lines.map(row => <label className="my-3 grid gap-1 text-sm" key={row.code}>{row.name} · {row.code} · 已签收 {row.signedQty} {row.unit}<NativeSelect value={selected[row.code] || ''} onChange={event => change(() => setSelected(old => ({ ...old, [row.code]: event.target.value })))}><option value="">批号待补</option>{row.signedBatches?.map(batch => <option key={batch.batchNo} value={batch.batchNo}>{batch.batchNo} · {batch.quantity} {row.unit}</option>)}</NativeSelect></label>)}{!lines.length && <p className="text-sm text-muted-foreground">暂无已签收物料，批次信息待补。</p>}<Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>刷新实领批次</Button></details>
      </fieldset>}
    </div>
    <div className="production-editor-footer">{reviewNote && <p role="status" className="mb-3 text-sm">{reviewNote}</p>}{error && <div role="alert" className="text-sm text-destructive"><p>{error}</p>{submissionFailed && <Button size="sm" variant="outline" disabled={busy} onClick={() => void reviewLatest()}>保留草稿并重新核对</Button>}{loadFailed && <Button size="sm" variant="outline" onClick={() => setReload(value => value + 1)}>重新读取实领批次</Button>}</div>}{discard ? <div role="alert"><p className="mb-2 text-sm">现场记录尚未保存，是否放弃？</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>继续填写</Button><Button variant="destructive" onClick={onClose}>放弃并关闭</Button></div></div> : <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={close}>取消</Button><Button onClick={() => void save()} disabled={busy || loading || loadFailed || !report}>{busy ? '正在处理…' : '提交不良'}</Button></div>}</div>
  </DialogContent></Dialog>;
}
