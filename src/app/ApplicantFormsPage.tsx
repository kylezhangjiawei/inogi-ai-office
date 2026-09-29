import { useConfirmation } from './components/ui/use-confirmation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { ArrowDown, ArrowUp, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, FileText, History, Loader2, Pencil, Plus, Save, Send, Smartphone, Sparkles, Trash2, Undo2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from './auth';
import { hasPermission } from './lib/permissions';
import { Button } from './components/ui/button';
import { Switch } from './components/ui/switch';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { ApplicantFormsError, createApplicantTemplate, getApplicantTemplate, listApplicantTemplates, listApplicantVersions, publishApplicantTemplate, saveApplicantTemplate, suggestApplicantForm } from './lib/applicantFormsApi';
import type { AiSuggestion, FieldStage, FormField, FormSchema, FormVersion, TemplateDetail, TemplateSummary } from './lib/applicantFormsApi';
import { ApplicantFormRenderer } from './applicant-forms/ApplicantFormRenderer';
import { FieldEditor, FIELD_TYPE_LABELS, newFormField, STAGE_LABELS } from './applicant-forms/FieldEditor';
import { SubmissionRecords } from './applicant-forms/SubmissionRecords';
import './applicant-forms/admin.css';
import { NativeSelect } from "./components/ui/native-select";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

const messageOf = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重试';
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const AI_EXAMPLES = ['增加预计到岗日期，设为必填', '工作经历改为选填，支持添加多段经历', '增加应聘岗位单选：生产、研发、行政'];
const fingerprint = (schema: FormSchema, name = '') => JSON.stringify([name, schema], (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value);

export function ApplicantFormsPage() {
  const { confirm, confirmationDialog } = useConfirmation();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canEdit = hasPermission(permissions, 'applicant-form:edit');
  const canPublish = hasPermission(permissions, 'applicant-form:publish');
  const canRecords = hasPermission(permissions, 'applicant-form:records');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [name, setName] = useState('');
  const [versions, setVersions] = useState<FormVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<'save' | 'publish' | 'create' | 'ai' | ''>('');
  const [activeTab, setActiveTab] = useState<'builder' | 'records' | 'versions'>('builder');
  const [stage, setStage] = useState<FieldStage>('application');
  const [prompt, setPrompt] = useState('');
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [undoStack, setUndoStack] = useState<FormSchema[]>([]);
  const [editing, setEditing] = useState<FormField | null>(null);
  const [deleting, setDeleting] = useState<FormField | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState<'new' | 'copy' | null>(null);
  const [newName, setNewName] = useState('');
  const [pendingTemplateId, setPendingTemplateId] = useState('');
  const [conflict, setConflict] = useState(false);
  const [listError, setListError] = useState('');
  const [metadataError, setMetadataError] = useState('');
  const dirty = !!schema && !!template && fingerprint(schema, name) !== fingerprint(template.schema, template.name);
  const blocker = useBlocker(dirty);
  const currentDraft = useRef('');
  const metadataRequest = useRef<AbortController | null>(null);
  const currentTemplateId = useRef(selectedId);
  currentTemplateId.current = selectedId;
  currentDraft.current = schema ? fingerprint(schema, name) : '';
  const locked = !!busy || loadingTemplate;

  useEffect(() => { const controller = new AbortController(); setLoading(true); setListError(''); listApplicantTemplates(controller.signal).then((result) => { setTemplates(result.items); setSelectedId((current) => current || result.items[0]?.id || ''); }).catch((error) => { if (!controller.signal.aborted) setListError(messageOf(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController(); setLoadingTemplate(true); setError(''); setSuggestion(null); setUndoStack([]); setConflict(false);
    Promise.all([getApplicantTemplate(selectedId, controller.signal), listApplicantVersions(selectedId, controller.signal)]).then(([detail, history]) => { setTemplate(detail); setSchema(detail.schema); setName(detail.name); setVersions(history.items); }).catch((error) => { if (!controller.signal.aborted) { setTemplate(null); setSchema(null); setError(messageOf(error)); } }).finally(() => { if (!controller.signal.aborted) setLoadingTemplate(false); });
    return () => controller.abort();
  }, [selectedId, refresh]);
  useEffect(() => { if (!dirty) return; const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  useEffect(() => { if (selectedId && activeTab !== 'builder') void refreshMetadata(); }, [selectedId, activeTab]);
  useEffect(() => () => metadataRequest.current?.abort(), []);

  async function refreshMetadata() {
    if (!selectedId) return;
    metadataRequest.current?.abort();
    const controller = new AbortController(); metadataRequest.current = controller;
    const id = selectedId; setMetadataError('');
    try {
      const [detail, history] = await Promise.all([getApplicantTemplate(id, controller.signal), listApplicantVersions(id, controller.signal)]);
      if (controller.signal.aborted || currentTemplateId.current !== id) return;
      // Counts and version snapshots refresh independently of the editor's schema, name and revision.
      setVersions(history.items);
      setTemplate((current) => current?.id === id ? { ...current, submissionCount: detail.submissionCount } : current);
      setTemplates((items) => items.map((item) => item.id === id ? { ...item, submissionCount: detail.submissionCount } : item));
    } catch (error) { if (!controller.signal.aborted && currentTemplateId.current === id) setMetadataError(`登记数量刷新失败：${messageOf(error)}`); }
  }

  function changeSchema(next: FormSchema) { if (!schema || !canEdit || locked) return; setUndoStack((history) => [...history.slice(-19), schema]); setSchema(next); setSuggestion(null); setError(''); }
  function changeField(field: FormField) { if (!schema) return; const exists = schema.fields.some((item) => item.id === field.id); changeSchema({ ...schema, fields: exists ? schema.fields.map((item) => item.id === field.id ? field : item) : [...schema.fields, field] }); setEditing(null); }
  function moveField(id: string, direction: -1 | 1) { if (!schema) return; const fields = [...schema.fields]; const index = fields.findIndex((field) => field.id === id); const destination = fields.findIndex((field, i) => i !== index && field.stage === stage && (direction === -1 ? i < index && !fields.slice(i + 1, index).some((item) => item.stage === stage) : i > index)); if (destination < 0) return; [fields[index], fields[destination]] = [fields[destination], fields[index]]; changeSchema({ ...schema, fields }); }
  function adopt(detail: TemplateDetail) { setTemplate(detail); setSchema(detail.schema); setName(detail.name); setTemplates((items) => items.some((item) => item.id === detail.id) ? items.map((item) => item.id === detail.id ? detail : item) : [detail, ...items]); setConflict(false); }
  async function saveDraft() { if (!template || !schema || !canEdit || conflict) return; setBusy('save'); setError(''); try { const result = await saveApplicantTemplate(template.id, { expectedRevision: template.revision, name, schema }); adopt(result); toast.success('草稿已保存，正式填写页面尚未改变'); } catch (error) { setError(messageOf(error)); if (error instanceof ApplicantFormsError && error.status === 409) setConflict(true); } finally { setBusy(''); } }
  async function publish() { if (!template || dirty || suggestion || !canPublish || conflict) return; setBusy('publish'); setError(''); try { const result = await publishApplicantTemplate(template.id, template.revision); adopt(result.template); setVersions((items) => [result.version, ...items.filter((item) => item.id !== result.version.id)]); setPublishOpen(false); toast.success(`V${result.version.version} 已发布，填写链接已生效`); } catch (error) { setError(messageOf(error)); setPublishOpen(false); if (error instanceof ApplicantFormsError && error.status === 409) setConflict(true); } finally { setBusy(''); } }
  async function generateSuggestion() {
    if (!schema || !prompt.trim() || !canEdit) return;
    const snapshot = currentDraft.current; setBusy('ai'); setError(''); setSuggestion(null);
    try { const result = await suggestApplicantForm(schema, prompt.trim()); if (snapshot !== currentDraft.current) { toast.info('草稿已变化，请基于最新草稿重新生成建议'); return; } setSuggestion(result); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(''); }
  }
  async function create() { if (!newName.trim() || !canEdit || (newTemplate === 'copy' && !schema)) return; setBusy('create'); setError(''); try { const result = await createApplicantTemplate({ name: newName.trim(), ...(newTemplate === 'copy' && schema ? { schema } : {}) }); adopt(result); setSelectedId(result.id); setNewTemplate(null); setActiveTab('builder'); setUndoStack([]); setSuggestion(null); toast.success('模板草稿已创建'); } catch (error) { setError(messageOf(error)); toast.error(messageOf(error)); } finally { setBusy(''); } }
  async function requestCreate(kind: 'new' | 'copy') { if (dirty && kind === 'new' && !await confirm({ title: '离开未保存的草稿', description: '当前草稿尚未保存，创建新模板将离开当前草稿。是否继续？', actionLabel: '继续创建' })) return; setNewName(kind === 'copy' ? `${name}（副本）` : '应聘登记表'); setNewTemplate(kind); }
  async function copyLink() { if (!template?.publicPath) return; try { await navigator.clipboard.writeText(new URL(template.publicPath, window.location.origin).href); toast.success('填写链接已复制，可发给应聘人员'); } catch { toast.error('复制失败，请选中下方填写链接手动复制'); } }
  const fields = schema?.fields.filter((field) => field.stage === stage) ?? [];
  const previewSchema = suggestion?.schema ?? schema;
  const liveUrl = template?.publicPath ? new URL(template.publicPath, window.location.origin).href : '';
  const hasPublishedChanges = !!template && !!schema && (!versions[0] || fingerprint(versions.find((version) => version.id === template.publishedVersionId)?.schema ?? versions[0].schema) !== fingerprint(schema));

  return <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="horizon-theme af-admin-page gap-0">
    {confirmationDialog}
    <header className="af-page-header"><div><div className="af-breadcrumb">人事与行政 <span>/</span> 应聘登记 <span>/</span> {activeTab === 'builder' ? '表单模板' : activeTab === 'records' ? '登记记录' : '发布历史'}</div><div className="af-title-line"><h1>应聘登记表</h1><span className="af-pill">{dirty ? '未保存' : template?.publishedVersion ? `已发布 V${template.publishedVersion}` : '草稿'}</span></div><p>{template ? `最后保存：${timestamp(template.updatedAt)}${dirty ? ' · 有尚未保存的修改' : ''}` : '把登记资料整理成一份可以分享的手机表单'}</p></div><div className="af-header-actions">{canEdit ? <Button variant="outline" disabled={!dirty || locked || conflict} onClick={saveDraft}><Save size={15} />{busy === 'save' ? '正在保存…' : '保存草稿'}</Button> : null}{canPublish ? <Button disabled={!template || dirty || !!suggestion || locked || conflict || !hasPublishedChanges} onClick={() => setPublishOpen(true)}><Send size={15} />发布表单</Button> : null}</div></header>
    <div className="af-workspace-toolbar"><label className="af-template-select"><FileText size={16} /><NativeSelect aria-label="选择表单模板" disabled={locked} value={selectedId} onChange={(event) => { if (dirty) setPendingTemplateId(event.target.value); else setSelectedId(event.target.value); }}><option value="" disabled>选择表单模板</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect><ChevronDown size={14} /></label><div className="af-inline-actions">{canEdit ? <><Button variant="ghost" size="sm" disabled={locked} onClick={() => requestCreate('new')}><Plus size={15} />新建模板</Button><Button variant="ghost" size="sm" disabled={!schema || locked} onClick={() => requestCreate('copy')}><Copy size={14} />复制模板</Button></> : null}</div></div>
    <TabsList className="af-main-tabs h-auto w-full justify-start rounded-none bg-transparent" aria-label="应聘登记管理"><TabsTrigger value="builder" className={activeTab === 'builder' ? 'active' : ''}><FileText size={16} />表单模板</TabsTrigger>{canRecords ? <TabsTrigger value="records" className={activeTab === 'records' ? 'active' : ''}><Users size={16} />登记记录{template ? <span>{template.submissionCount}</span> : null}</TabsTrigger> : null}<TabsTrigger value="versions" className={activeTab === 'versions' ? 'active' : ''}><History size={16} />发布历史</TabsTrigger></TabsList>
    {listError ? <div className="af-error" role="alert">{listError}<Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>重试</Button></div> : null}
    {metadataError ? <div className="af-error" role="alert">{metadataError}<Button variant="outline" size="sm" onClick={() => void refreshMetadata()}>重试</Button></div> : null}
    {error ? <div className="af-error" role="alert">{error}{conflict ? <><p>最新草稿已被其他人修改，你的本地修改仍保留。可复制为新模板，或放弃本地修改后重新读取。</p><div className="af-inline-actions">{canEdit ? <Button variant="outline" size="sm" onClick={() => requestCreate('copy')}>复制当前草稿</Button> : null}<Button variant="outline" size="sm" onClick={async () => { if (await confirm({ title: '重新读取草稿', description: '重新读取将替换当前未保存的草稿，继续吗？', actionLabel: '放弃修改并读取', destructive: true })) setRefresh((value) => value + 1); }}>重新读取</Button></div></> : null}</div> : null}
    {loading || loadingTemplate ? <div className="af-loading"><Loader2 className="animate-spin" size={20} />正在加载表单模板</div> : !template || !schema ? <div className="af-panel af-empty"><FileText size={34} /><h2>{error ? '暂时无法加载模板' : '创建第一份应聘登记表'}</h2><p>从员工入职登记表整理的默认模板开始，调整字段和必填项，再发布手机填写链接。</p>{canEdit && !error ? <Button onClick={() => requestCreate('new')}><Plus size={16} />使用默认模板</Button> : null}{error ? <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>重新加载</Button> : null}</div> : <>
      {template.publicPath ? <div className="af-published-link"><CheckCircle2 size={18} /><div><strong>V{template.publishedVersion} 填写链接已生效</strong><Input readOnly aria-label="公开填写链接" value={liveUrl} onFocus={(event) => event.target.select()} /></div><Button variant="outline" size="sm" onClick={copyLink}><Copy size={14} />复制链接</Button><a className="af-link-icon" href={liveUrl} target="_blank" rel="noreferrer" aria-label="打开正式填写页面"><ExternalLink size={17} /></a></div> : null}
      <TabsContent value={activeTab} className="mt-0">{activeTab === 'builder' ? <><ToggleGroup type="single" value={stage} onValueChange={(value) => { if (value) setStage(value as FieldStage); }} className="af-stage-tabs" aria-label="字段填写阶段">{Object.entries(STAGE_LABELS).map(([value, label]) => <ToggleGroupItem key={value} value={value} className={stage === value ? 'active' : ''}>{label}</ToggleGroupItem>)}</ToggleGroup><div className="af-builder-grid"><section className="af-panel af-config-panel"><div className="af-ai-heading"><Sparkles size={25} /><h2>用 AI 调整表单</h2></div><p className="af-subtle">说出你的想法，AI 帮你整理字段和填写要求</p><div className="af-ai-composer"><Textarea aria-label="告诉 AI 如何调整表单" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} disabled={!canEdit || locked} placeholder="例如：增加预计到岗日期，设为必填；工作经历改为选填。" /><Button variant="outline" size="sm" disabled={!canEdit || locked || !prompt.trim()} onClick={generateSuggestion}>{busy === 'ai' ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}{busy === 'ai' ? '正在整理建议…' : '生成建议'}</Button></div>{!suggestion ? <div className="af-ai-examples">{AI_EXAMPLES.map((text) => <Button variant="unstyled" key={text} disabled={!canEdit || locked} onClick={() => setPrompt(text)}>{text}</Button>)}</div> : <><div className="af-suggestion"><h3>建议调整 {suggestion.summary.length} 项</h3><ul>{suggestion.summary.map((text, index) => <li key={index}><Check size={15} /><span>{text}</span></li>)}</ul></div><div className="af-suggestion-actions"><Button disabled={locked || !canEdit} onClick={() => { if (!schema || !suggestion) return; changeSchema(suggestion.schema); toast.success('建议已应用到草稿，可以继续修改或撤销'); }}>应用到草稿</Button><Button variant="ghost" onClick={() => setSuggestion(null)}>放弃</Button></div><p className="af-help">应用后可撤销；保存并发布后才会更新填写链接。</p></>}
        <div className="af-fields-divider" /><div className="af-section-heading"><h2>{suggestion ? '当前草稿字段' : '调整表单字段'}</h2>{undoStack.length ? <Button variant="ghost" size="sm" disabled={locked || !canEdit} onClick={() => { setSchema(undoStack[undoStack.length - 1]); setUndoStack((items) => items.slice(0, -1)); setSuggestion(null); }}><Undo2 size={14} />撤销</Button> : null}</div>{stage !== 'application' ? <p className="af-stage-notice">{stage === 'internal' ? '内部审核字段不会出现在公开填写页面。当前可配置模板字段，审核记录在“登记详情”中维护。' : '此阶段保留录用后的补填字段，不会出现在本次应聘链接中。'}</p> : null}
        <div className="af-field-table"><div className="af-field-table-head"><span>字段</span><span>显示</span><span>必填</span><span className="sr-only">操作</span></div>{fields.length ? fields.map((field, index) => <div className="af-field-row" key={field.id}><Button variant="unstyled" className="af-field-edit-trigger" disabled={!canEdit || locked} onClick={() => setEditing(field)}><span>{field.label}<Pencil size={12} /></span><small>{field.section || '未分组'} · {FIELD_TYPE_LABELS[field.type]}{field.condition ? ' · 按答案显示' : ''}</small></Button><Switch checked={field.visible} disabled={!canEdit || locked} aria-label={`${field.label}显示`} onCheckedChange={(visible) => changeField({ ...field, visible })} /><Switch checked={field.required} disabled={!canEdit || locked || !field.visible} aria-label={`${field.label}必填`} onCheckedChange={(required) => changeField({ ...field, required })} /><div className="af-field-tools"><Button variant="unstyled" aria-label={`${field.label}上移`} disabled={!canEdit || locked || index === 0} onClick={() => moveField(field.id, -1)}><ArrowUp size={13} /></Button><Button variant="unstyled" aria-label={`${field.label}下移`} disabled={!canEdit || locked || index === fields.length - 1} onClick={() => moveField(field.id, 1)}><ArrowDown size={13} /></Button><Button variant="unstyled" aria-label={`删除${field.label}`} disabled={!canEdit || locked} onClick={() => setDeleting(field)}><Trash2 size={13} /></Button></div></div>) : <p className="af-fields-empty">此阶段还没有字段。</p>}</div>{canEdit ? <Button className="af-add-field" variant="outline" disabled={locked || schema.fields.length >= 80} onClick={() => setEditing(newFormField(stage, fields[fields.length - 1]?.section ?? '基本资料'))}><Plus size={16} />手动添加字段</Button> : null}
        <details className="af-template-settings"><summary>表单名称与说明</summary><div className="af-editor-fields"><label>内部模板名称<Input value={name} maxLength={120} disabled={!canEdit || locked} onChange={(event) => { setName(event.target.value); setSuggestion(null); }} /></label><label>填写页面标题<Input value={schema.title} maxLength={120} disabled={!canEdit || locked} onChange={(event) => changeSchema({ ...schema, title: event.target.value })} /></label><label>填写说明<Textarea rows={3} value={schema.description} maxLength={2000} disabled={!canEdit || locked} onChange={(event) => changeSchema({ ...schema, description: event.target.value })} /></label></div></details>
      </section><section className="af-panel af-preview-panel"><div className="af-preview-heading"><div><h2>手机填写预览 <span className={`af-preview-badge ${suggestion ? 'suggestion' : ''}`}>{suggestion ? '建议效果 · 尚未应用' : !hasPublishedChanges && !dirty ? `与已发布 V${template.publishedVersion} 一致` : '草稿效果 · 尚未发布'}</span></h2><p>实时预览应聘人员手机端的填写效果</p></div><Smartphone size={20} /></div><div className="af-phone-preview">{previewSchema ? <ApplicantFormRenderer schema={previewSchema} preview /> : null}</div><p className="af-preview-footer">预览填写不会生成登记记录。正式链接始终使用最近发布的版本。</p></section></div></> : activeTab === 'records' && canRecords ? <SubmissionRecords key={template.id} templateId={template.id} versions={versions} onRefreshMetadata={refreshMetadata} /> : <section className="af-panel af-versions"><div className="af-section-heading"><div><h2>发布历史</h2><p>每次发布保存一份独立版本，历史登记不会随着模板修改而变化。</p></div><span>{versions.length} 个版本</span></div>{versions.length ? versions.map((version) => <article key={version.id}><div className="af-version-mark">V{version.version}</div><div><h3>{version.schema.title}{version.id === template.publishedVersionId ? <span className="af-pill">当前公开版本</span> : null}</h3><p>{timestamp(version.publishedAt)} 发布 · {version.schema.fields.filter((field) => field.visible && field.stage === 'application').length} 个应聘字段</p></div><span>{version.submissionCount} 条登记</span><details><summary>查看版本字段</summary><ul>{version.schema.fields.map((field) => <li key={field.id}>{field.label}<span>{STAGE_LABELS[field.stage]} · {field.visible ? field.required ? '必填' : '选填' : '隐藏'}</span></li>)}</ul></details></article>) : <div className="af-empty"><History size={28} /><h3>还没有发布版本</h3><p>保存草稿并点击“发布表单”后，即可生成正式填写链接。</p></div>}</section>}</TabsContent>
    </>}
    {editing && schema ? <FieldEditor key={editing.id} field={editing} peers={schema.fields} onSave={changeField} onClose={() => setEditing(null)} /> : null}
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>从草稿中删除“{deleting?.label}”？</AlertDialogTitle><AlertDialogDescription>历史登记资料会保留。删除后可以撤销；发布后新填写页面将不再显示此字段。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><Button variant="destructive" onClick={() => { if (!deleting || !schema) return; if (schema.fields.length <= 1) { toast.error('模板至少需要保留一个字段'); return; } const ids = new Set([deleting.id, ...(deleting.children ?? []).map((field) => field.id)]); const dependency = schema.fields.find((field) => field.condition && ids.has(field.condition.fieldId)); if (dependency) { toast.error(`“${dependency.label}”的显示条件引用了此字段，请先修改条件`); return; } changeSchema({ ...schema, fields: schema.fields.filter((field) => field.id !== deleting.id) }); setDeleting(null); }}>删除字段</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={publishOpen} onOpenChange={(open) => { if (busy !== 'publish') setPublishOpen(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>发布这份登记表？</AlertDialogTitle><AlertDialogDescription>将发布为 V{(template?.publishedVersion ?? 0) + 1}。{template?.publicPath ? '现有填写链接将展示新版本，正在填写的旧版本不受影响。' : '发布后会生成手机填写链接，可分享给应聘人员。'}历史登记仍按原版本保存。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy === 'publish'}>再检查一下</AlertDialogCancel><Button disabled={locked || dirty || !!suggestion || conflict} onClick={publish}>{busy === 'publish' ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}确认发布</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!newTemplate} onOpenChange={(open) => { if (!open && busy !== 'create') setNewTemplate(null); }}><DialogContent className="horizon-portal af-dialog"><DialogHeader><DialogTitle>{newTemplate === 'copy' ? '复制为新模板' : '新建登记模板'}</DialogTitle><DialogDescription>{newTemplate === 'copy' ? '复制当前草稿内容。原模板、发布记录与登记数据保持独立。' : '从员工入职登记表整理的默认字段开始，新模板需要单独发布。'}</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); void create(); }}><label>模板名称<Input required maxLength={120} autoFocus disabled={busy === 'create'} value={newName} onChange={(event) => setNewName(event.target.value)} /></label><DialogFooter className="mt-5"><Button type="button" variant="outline" disabled={busy === 'create'} onClick={() => setNewTemplate(null)}>取消</Button><Button type="submit" disabled={!newName.trim() || !!busy}>{busy === 'create' ? '正在创建…' : '创建草稿'}</Button></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={!!pendingTemplateId || blocker.state === 'blocked'} onOpenChange={(open) => { if (!open) { setPendingTemplateId(''); if (blocker.state === 'blocked') blocker.reset(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>草稿尚未保存</AlertDialogTitle><AlertDialogDescription>离开后，本次未保存的修改会丢失。可以先留在此页保存草稿。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><Button variant="outline" onClick={() => { if (pendingTemplateId) { setSelectedId(pendingTemplateId); setPendingTemplateId(''); } if (blocker.state === 'blocked') blocker.proceed(); }}>放弃修改并离开</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Tabs>;
}

export default ApplicantFormsPage;
