import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Download, Eye, FileClock, FolderOpen, History, Loader2, Maximize2, Plus, RefreshCw, Upload } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { cn } from '../components/ui/utils';
import { TechnicalDocumentPreview } from './TechnicalDocumentPreview';
import './technicalDocuments.css';
import { createRdTaskProgressNote, getAttachmentDownloadUrl, type RdTaskProgressAttachment, type RdTaskProgressNote } from '../lib/rdApi';
import {
  collectRdTechnicalAttachments, createRdTechnicalDocument, fetchRdTechnicalDocuments, isRegisteredTechnicalAttachment,
  prepareTechnicalDocumentRequest, RdTechnicalDocumentsError, technicalVersionAttachment,
  type PreparedTechnicalDocumentRequest, type RdTechnicalAttachmentChoice, type RdTechnicalDocument,
  type RdTechnicalDocumentCategory, type RdTechnicalDocumentsResponse,
} from '../lib/rdTechnicalDocumentsApi';
import { NativeSelect } from "../components/ui/native-select";

const categories: Record<RdTechnicalDocumentCategory, string> = { drawing: '图纸', specification: '规格', bom: 'BOM', validation: '验证资料', other: '其他' };
type DocumentFilter = RdTechnicalDocumentCategory | 'unclassified';
const control = 'min-h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
const action = 'min-h-10 gap-1.5 rounded-lg text-xs';
const primary = `${action} bg-primary text-primary-foreground hover:bg-primary/90`;
const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间待确认';
};

export interface TechnicalDocumentsPanelProps {
  taskId: string;
  notes: RdTaskProgressNote[];
  onPreview: (attachment: RdTaskProgressAttachment) => void;
  onDocumentsChange?: (documents: RdTechnicalDocument[]) => void;
  onNotesChanged?: (note: RdTaskProgressNote) => void;
  onUpload?: () => void;
}

interface Editor {
  documentId?: string;
  expectedCurrentVersionId?: string;
  title: string;
  category: RdTechnicalDocumentCategory | '';
  version: string;
  changeReason: string;
  attachmentKey: string;
}

/** Keyed state prevents another task's response or draft from appearing during navigation. */
export function TechnicalDocumentsPanel(props: TechnicalDocumentsPanelProps) {
  return <TaskTechnicalDocumentsPanel key={props.taskId} {...props} />;
}

function TaskTechnicalDocumentsPanel({ taskId, notes, onPreview, onDocumentsChange, onNotesChanged }: TechnicalDocumentsPanelProps) {
  const [data, setData] = useState<RdTechnicalDocumentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [localNotes, setLocalNotes] = useState<RdTaskProgressNote[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<DocumentFilter | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<{ documentId: string; versionId: string } | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadBusy = useRef(false);
  const uploadDraft = useRef<Editor | null>(null);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const prepared = useRef<PreparedTechnicalDocumentRequest | null>(null);
  const readSequence = useRef(0);
  const changed = useRef(onDocumentsChange);
  const notesChanged = useRef(onNotesChanged);
  useEffect(() => { changed.current = onDocumentsChange; }, [onDocumentsChange]);
  useEffect(() => { notesChanged.current = onNotesChanged; }, [onNotesChanged]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++readSequence.current;
    setLoading(true); setLoadError('');
    void fetchRdTechnicalDocuments(taskId, controller.signal).then((next) => {
      if (controller.signal.aborted || !mounted.current || sequence !== readSequence.current) return;
      setData(next);
      changed.current?.(next.documents);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || !mounted.current || sequence !== readSequence.current) return;
      setLoadError(error instanceof Error ? error.message : '技术资料加载失败，请重试');
    }).finally(() => {
      if (!controller.signal.aborted && mounted.current && sequence === readSequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [taskId, refresh]);

  const choices = useMemo(() => {
    const refreshedIds = new Set(notes.map((note) => note.id));
    return collectRdTechnicalAttachments(taskId, [...notes, ...localNotes.filter((note) => !refreshedIds.has(note.id))]);
  }, [taskId, localNotes, notes]);
  const documents = data?.documents ?? [];
  const unregistered = choices.filter((choice) => !isRegisteredTechnicalAttachment(choice, documents));
  const selectedFile = choices.find((choice) => choice.key === editor?.attachmentKey);
  const editingDocument = documents.find((document) => document.id === editor?.documentId);
  const newerVersion = Boolean(editor?.documentId && editingDocument && editingDocument.currentVersionId !== editor.expectedCurrentVersionId);
  const canEdit = Boolean(data?.canEdit && !loadError && !loading);
  const activeCategory = (categoryFilter === 'unclassified' && !unregistered.length ? null : categoryFilter) ?? documents[0]?.category ?? (unregistered.length ? 'unclassified' : 'drawing');
  const filteredDocuments = documents.filter((document) => document.category === activeCategory);
  const viewedDocument = filteredDocuments.find((document) => document.id === selectedDocumentId) ?? filteredDocuments[0];
  const viewedVersion = viewedDocument?.versions.find((version) => version.id === (selectedVersion?.documentId === viewedDocument.id ? selectedVersion.versionId : viewedDocument.currentVersionId))
    ?? viewedDocument?.versions.find((version) => version.id === viewedDocument.currentVersionId);
  const viewedCandidate = activeCategory === 'unclassified' ? unregistered.find((choice) => choice.key === selectedCandidateKey) ?? unregistered[0] : undefined;
  const viewedAttachment = viewedCandidate?.attachment ?? (viewedVersion ? technicalVersionAttachment(viewedVersion) : undefined);
  const hasFiles = Boolean(documents.length || choices.length);
  const displayTitle = viewedCandidate?.attachment.name ?? viewedVersion?.title ?? viewedDocument?.title ?? '';
  const currentVersion = viewedDocument?.versions.find((version) => version.id === viewedDocument.currentVersionId);
  const downloadUrl = viewedAttachment ? getAttachmentDownloadUrl(viewedAttachment) : '';
  const canDownload = /^(https?:\/\/|\/(?!\/)|data:)/i.test(downloadUrl);

  function selectCategory(value: DocumentFilter) {
    setCategoryFilter(value); setSelectedDocumentId(''); setSelectedVersion(null); setSelectedCandidateKey('');
  }

  function start(document?: RdTechnicalDocument, file?: RdTechnicalAttachmentChoice, category?: RdTechnicalDocumentCategory) {
    if (saving || uploadBusy.current) return;
    prepared.current = null;
    setEditor({ documentId: document?.id, expectedCurrentVersionId: document?.currentVersionId ?? undefined, title: document?.title ?? file?.attachment.name ?? '', category: document?.category ?? category ?? '', version: '', changeReason: '', attachmentKey: file?.key ?? '' });
    setEditorOpen(true); setConfirming(false); setSaveError(''); setConflict(false); setNotice('');
  }

  function edit<K extends keyof Editor>(key: K, value: Editor[K]) {
    setEditor((current) => current ? { ...current, [key]: value } : current);
    setConfirming(false); setSaveError('');
  }

  function validate(): string {
    if (uploadBusy.current) return '文件正在上传，请稍候再确认版本。';
    if (!canEdit) return '当前无法登记，请先重新加载并确认编辑权限。';
    if (!editor?.title.trim() || !editor.category || !editor.version.trim() || !editor.changeReason.trim()) return '请填写资料名称、类别、版本标识和登记说明。';
    if (!selectedFile) return '请选择当前任务中仍可用的已上传文件。';
    if (editor.documentId && (!editingDocument || !editor.expectedCurrentVersionId)) return '当前资料版本信息不完整，请重新加载。';
    if (newerVersion) return '该资料已有新版本，请先查看并确认当前版本。';
    if (editingDocument?.versions.some((version) => version.version === editor.version.trim())) return '该版本标识已存在，请填写新的版本标识。';
    return '';
  }

  function review(event: FormEvent) {
    event.preventDefault();
    const error = validate();
    if (error) { setSaveError(error); return; }
    setSaveError(''); setConfirming(true);
  }

  async function save() {
    if (operation.current || !editor) return;
    const error = validate();
    if (error) { setSaveError(error); return; }
    const input = {
      ...(editor.documentId ? { documentId: editor.documentId, expectedCurrentVersionId: editor.expectedCurrentVersionId } : {}),
      title: editor.title.trim(), category: editor.category as RdTechnicalDocumentCategory,
      version: editor.version.trim(), changeReason: editor.changeReason.trim(),
      sourceNoteId: selectedFile!.sourceNoteId, attachmentId: selectedFile!.attachment.id,
      expectedFileKey: selectedFile!.attachment.object_key ?? '',
      expectedFileName: selectedFile!.attachment.name, expectedFileSize: selectedFile!.attachment.size,
    };
    prepared.current = prepareTechnicalDocumentRequest(prepared.current, input);
    const controller = new AbortController();
    operation.current = controller; setSaving(true); setSaveError(''); setConflict(false);
    try {
      const next = await createRdTechnicalDocument(taskId, prepared.current.input, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      ++readSequence.current;
      setData(next); setLoading(false); setLoadError('');
      const savedDocument = next.documents.find((document) => input.documentId ? document.id === input.documentId : document.versions.some((version) => version.version === input.version && version.attachmentId === input.attachmentId && version.sourceNoteId === input.sourceNoteId));
      if (savedDocument) { setCategoryFilter(savedDocument.category); setSelectedDocumentId(savedDocument.id); setSelectedVersion(null); }
      changed.current?.(next.documents);
      setEditor(null); setEditorOpen(false); setConfirming(false); prepared.current = null;
      setNotice('资料版本已登记，可查看当前版本及历史记录。');
    } catch (error: unknown) {
      if (!mounted.current || controller.signal.aborted) return;
      setSaveError(error instanceof Error ? error.message : '保存未完成，请保留当前内容并重试确认。');
      setConflict(error instanceof RdTechnicalDocumentsError && error.status === 409);
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setSaving(false);
    }
  }

  function upload(document?: RdTechnicalDocument) {
    if (!canEdit || saving || uploadBusy.current) return;
    uploadDraft.current = document
      ? { documentId: document.id, expectedCurrentVersionId: document.currentVersionId ?? undefined, title: document.title, category: document.category, version: '', changeReason: '', attachmentKey: '' }
      : editor;
    fileInput.current?.click();
  }

  async function uploadFile(file: File) {
    if (!canEdit || saving || uploadBusy.current) return;
    const draft = uploadDraft.current;
    uploadBusy.current = true; setUploading(true); setUploadError('');
    try {
      const note = await createRdTaskProgressNote({ task_id: taskId, text: `上传技术资料：${file.name}`, files: [file] });
      if (!mounted.current) return;
      const choice = collectRdTechnicalAttachments(taskId, [note])[0];
      if (!choice) throw new Error('上传已返回，但未找到本任务的附件。请刷新原附件后再选择文件。');
      setLocalNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
      notesChanged.current?.(note);
      setEditor({ ...(draft ?? { title: '', category: '', version: '', changeReason: '' }), title: draft?.title || file.name, attachmentKey: choice.key });
      prepared.current = null;
      setEditorOpen(true); setConfirming(false); setSaveError(''); setConflict(false);
      setNotice('文件已上传，请核对类别、版本标识及说明后确认登记。');
    } catch (error: unknown) {
      if (mounted.current) setUploadError(error instanceof Error ? error.message : '上传未完成，请核对原附件后重试。填写内容已保留。');
    } finally {
      uploadBusy.current = false;
      if (mounted.current) setUploading(false);
    }
  }

  return <section className="rd-technical-documents min-w-0 rounded-xl border border-slate-200 bg-white" aria-label="技术资料与版本">
    <Input ref={fileInput} type="file" className="hidden" aria-label="上传单个技术资料文件" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadFile(file); }} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-balance text-sm font-semibold text-slate-900"><FileClock aria-hidden="true" className="size-4 text-primary" />相关文件</h3><p className="mt-1 text-pretty text-xs leading-5 text-slate-500">选择资料，核对原件与版本记录。</p></div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className={action} disabled={loading || saving || uploading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw aria-hidden="true" className="size-3.5" />刷新</Button>
        {canEdit && hasFiles ? <Button type="button" variant="outline" className={action} disabled={saving || uploading} onClick={() => upload()}><Upload aria-hidden="true" className="size-3.5" />上传新文件</Button> : null}
        {canEdit && hasFiles ? <Button type="button" variant="outline" className={action} disabled={saving || uploading} onClick={() => editor ? setEditorOpen(true) : start()}><Plus aria-hidden="true" className="size-3.5" />{editor ? '继续登记' : '登记资料'}</Button> : null}
      </div>
    </div>
    <div className="space-y-3 p-3 sm:p-4">
      {notice ? <p role="status" className="rounded-lg bg-primary/5 px-3 py-2 text-pretty text-xs leading-5 text-primary">{notice}</p> : null}
      {uploading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Upload aria-hidden="true" className="size-4" />正在上传文件，上传后继续核对版本…</p> : null}
      {uploadError && !editorOpen ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-pretty text-sm text-rose-800">{uploadError}</p> : null}
      {loadError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p>{loadError}</p><Button type="button" variant="outline" className={cn(action, 'mt-2')} onClick={() => setRefresh((value) => value + 1)}>重新加载</Button></div> : loading ? <div role="status" aria-label="正在读取技术资料" className="space-y-3 py-2"><div className="h-10 rounded-lg bg-slate-100" /><div className="grid grid-cols-3 gap-3"><div className="col-span-2 h-24 rounded-lg bg-slate-50" /><div className="h-24 rounded-lg bg-slate-50" /></div><span className="sr-only">正在读取技术资料…</span></div> : data ? !hasFiles ? <div className="flex flex-col items-start gap-3 rounded-lg bg-slate-50 p-5">
        <FolderOpen aria-hidden="true" className="size-6 text-muted-foreground" /><div><p className="text-balance text-sm font-medium text-slate-800">暂无技术资料</p><p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{canEdit ? '先上传一份图纸、规格或验证资料，再确认版本。' : '资料登记后，可在这里查看原件和历史版本。'}</p></div>
        {canEdit ? <Button type="button" className={primary} disabled={uploading || saving} onClick={() => upload()}><Upload aria-hidden="true" className="size-3.5" />上传新文件</Button> : null}
      </div> : <Tabs value={activeCategory} onValueChange={(value) => selectCategory(value as DocumentFilter)} className="gap-3">
        <TabsList aria-label="资料分类" className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg bg-slate-50 p-1">
          {Object.entries(categories).map(([value, label]) => <TabsTrigger key={value} value={value} className="min-h-10 flex-none px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-none">
            {label}<span className="text-[11px] tabular-nums text-muted-foreground">{documents.filter((document) => document.category === value).length}</span>
          </TabsTrigger>)}
          {unregistered.length ? <TabsTrigger value="unclassified" className="min-h-10 flex-none px-3 text-xs data-[state=active]:bg-white data-[state=active]:shadow-none">待确认<span className="text-[11px] tabular-nums text-muted-foreground">{unregistered.length}</span></TabsTrigger> : null}
        </TabsList>
        <TabsContent value={activeCategory} className="space-y-3">
          {activeCategory === 'unclassified' && viewedCandidate ? <label className="block min-w-0 space-y-1.5 text-xs font-medium text-slate-600"><span>选择待确认附件</span><NativeSelect aria-label="选择待确认附件" className={control} value={viewedCandidate.key} onChange={(event) => setSelectedCandidateKey(event.target.value)}>{unregistered.map((choice) => <option key={choice.key} value={choice.key}>{choice.attachment.name} · {formatDate(choice.uploadedAt)}</option>)}</NativeSelect></label> : viewedDocument && filteredDocuments.length > 1 ? <label className="block min-w-0 space-y-1.5 text-xs font-medium text-slate-600"><span>选择技术资料</span><NativeSelect aria-label="选择技术资料" className={control} value={viewedDocument.id} onChange={(event) => { setSelectedDocumentId(event.target.value); setSelectedVersion(null); }}>{filteredDocuments.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</NativeSelect></label> : null}
          {viewedAttachment ? <article className="rd-technical-document-viewer min-w-0 overflow-hidden rounded-lg border border-slate-200" aria-label="所选技术资料">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><h4 className="min-w-0 break-words text-balance text-sm font-semibold text-slate-800">{displayTitle}</h4><span className={cn('rounded px-2 py-1 text-xs tabular-nums', viewedCandidate ? 'bg-amber-50 text-amber-800' : 'bg-primary/5 text-primary')}>{viewedCandidate ? '版本待确认' : viewedVersion?.version}</span>{viewedVersion && viewedVersion.id !== viewedDocument?.currentVersionId ? <span className="text-xs text-slate-500">历史版本</span> : null}</div>
              {viewedDocument && viewedVersion && viewedDocument.versions.length > 1 ? <label className="flex min-w-0 items-center gap-2 text-xs text-slate-500"><span>查看版本</span><NativeSelect aria-label="查看资料版本" className="min-h-10 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" value={viewedVersion.id} onChange={(event) => setSelectedVersion({ documentId: viewedDocument.id, versionId: event.target.value })}>{viewedDocument.versions.map((version) => <option key={version.id} value={version.id}>{version.version}{version.id === viewedDocument.currentVersionId ? ' · 当前' : ''}</option>)}</NativeSelect></label> : null}
            </div>
            <div className="rd-technical-document-layout grid min-w-0 gap-0">
              <div className="rd-technical-document-preview-surface min-w-0 overflow-hidden border-b border-slate-100"><TechnicalDocumentPreview key={viewedCandidate?.key ?? viewedVersion?.id} attachment={viewedAttachment} /></div>
              <aside className="min-w-0 space-y-4 p-3" aria-label="文件信息">
                <h5 className="text-xs font-semibold text-slate-800">文件信息</h5>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs leading-5">
                  <dt className="text-slate-500">文件名称</dt><dd className="break-words text-slate-700">{viewedAttachment.name}</dd>
                  <dt className="text-slate-500">资料分类</dt><dd className="text-slate-700">{viewedCandidate ? '未分类' : categories[viewedVersion?.category ?? viewedDocument!.category]}</dd>
                  <dt className="text-slate-500">文件类型</dt><dd className="break-words text-slate-700">{fileTypeLabel(viewedAttachment)}</dd>
                  <dt className="text-slate-500">文件大小</dt><dd className="tabular-nums text-slate-700">{fileSizeLabel(viewedAttachment.size)}</dd>
                  <dt className="text-slate-500">当前版本</dt><dd className="tabular-nums text-slate-700">{viewedCandidate ? '待确认' : currentVersion?.version ?? '待确认'}</dd>
                  <dt className="text-slate-500">{viewedCandidate ? '上传时间' : '登记时间'}</dt><dd className="tabular-nums text-slate-700">{formatDate(viewedCandidate?.uploadedAt ?? viewedVersion!.createdAt)}</dd>
                  <dt className="text-slate-500">{viewedCandidate ? '上传人' : '登记人'}</dt><dd className="text-slate-700">{viewedCandidate?.uploadedBy ?? viewedVersion?.createdByName ?? '待确认'}</dd>
                </dl>
                {viewedVersion ? <div><p className="text-xs text-slate-500">版本说明</p><p className="mt-1 whitespace-pre-wrap break-words text-pretty text-xs leading-5 text-slate-700">{viewedVersion.changeReason}</p></div> : <p className="text-pretty text-xs leading-5 text-slate-500">此附件尚未登记资料类别与版本。</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className={cn(action, 'min-w-24 flex-1 px-2')} onClick={() => onPreview(viewedAttachment)} aria-label={viewedVersion ? '预览 ' + viewedVersion.fileName + ' ' + viewedVersion.version : '预览 ' + viewedAttachment.name}><Maximize2 aria-hidden="true" className="size-3.5" />放大预览</Button>
                  {canDownload ? <a className={cn(action, 'inline-flex min-w-24 flex-1 items-center justify-center whitespace-nowrap border border-slate-200 bg-white px-2 font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary')} href={downloadUrl} download={viewedAttachment.name} target="_blank" rel="noopener noreferrer" aria-label={'下载 ' + viewedAttachment.name}><Download aria-hidden="true" className="size-3.5" />下载文件</a> : null}
                </div>
              </aside>
            </div>
            {viewedDocument && viewedVersion ? <div className="border-t border-slate-100 px-3 py-3">
              <h5 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-800"><History aria-hidden="true" className="size-3.5 text-slate-500" />版本历史<span className="font-normal tabular-nums text-muted-foreground">（{viewedDocument.versions.length}）</span></h5>
              <ol className="flex flex-wrap gap-2" aria-label="版本历史">{viewedDocument.versions.map((version) => <li key={version.id} className="min-w-0 max-w-full"><Button type="button" variant="outline" className={cn('h-auto min-h-11 max-w-full justify-start gap-3 rounded-lg px-3 py-2 text-left', viewedVersion.id === version.id ? 'border-primary/30 bg-primary/5 text-primary' : 'border-slate-200 text-slate-600')} aria-pressed={viewedVersion.id === version.id} aria-label={'查看历史版本 ' + version.version} onClick={() => setSelectedVersion({ documentId: viewedDocument.id, versionId: version.id })}><span className="shrink-0 text-xs font-semibold tabular-nums">{version.version}{version.id === viewedDocument.currentVersionId ? ' · 当前' : ''}</span><span className="min-w-0"><span className="block text-[11px] tabular-nums">{formatDate(version.createdAt)}</span><span className="block max-w-48 truncate text-[11px] font-normal" title={version.changeReason}>{version.changeReason}</span></span></Button></li>)}</ol>
            </div> : null}
            {canEdit ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-3">
              {viewedCandidate ? <Button type="button" className={primary} disabled={saving || uploading} onClick={() => start(undefined, viewedCandidate)}><Check aria-hidden="true" className="size-3.5" />登记版本</Button> : viewedDocument ? <><Button type="button" variant="outline" className={action} disabled={!currentVersion || saving || uploading} onClick={() => upload(viewedDocument)}><Upload aria-hidden="true" className="size-3.5" />上传新版本文件</Button><Button type="button" className={primary} disabled={!currentVersion || saving || uploading} onClick={() => start(viewedDocument)}><Plus aria-hidden="true" className="size-3.5" />登记新版本</Button></> : null}
            </div> : null}
          </article> : <div className="rounded-lg bg-slate-50 px-4 py-5"><p className="text-balance text-sm font-medium text-slate-700">{viewedDocument ? '当前版本待确认' : activeCategory === 'unclassified' ? '暂无待确认附件' : '暂无' + categories[activeCategory] + '资料'}</p><p className="mt-1 text-pretty text-xs leading-5 text-slate-500">{viewedDocument ? '版本信息补齐后，可在这里查看原件。' : '可切换上方分类查看其他文件。'}</p>{canEdit && activeCategory !== 'unclassified' && !viewedDocument ? <Button type="button" className={cn(primary, 'mt-3')} onClick={() => start(undefined, undefined, activeCategory)}>登记该类资料</Button> : null}</div>}
        </TabsContent>
      </Tabs> : null}
    </div>

    <Dialog open={editorOpen && Boolean(editor)} onOpenChange={(open) => { if (!saving && !uploading) setEditorOpen(open); }}>
      <DialogContent closeDisabled={saving || uploading} className="horizon-portal max-h-[90dvh] w-[calc(100%-24px)] overflow-y-auto rounded-xl sm:max-w-xl" onEscapeKeyDown={(event) => { if (saving || uploading) event.preventDefault(); }} onInteractOutside={(event) => { if (saving || uploading) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{confirming ? '确认资料版本' : editor?.documentId ? '登记新版本' : '登记技术资料'}</DialogTitle><DialogDescription>{editor?.documentId ? '选择已上传文件并填写变更原因。确认后新增一版，历史版本继续保留。' : '请核对文件，并手动填写资料类别和实际版本标识。'}</DialogDescription></DialogHeader>
        {loadError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p>{loadError}</p><Button type="button" variant="outline" className={`${action} mt-2`} onClick={() => setRefresh((value) => value + 1)}>重新加载版本</Button></div> : !loading && data && !data.canEdit ? <p role="status" className="text-sm text-amber-800">当前账号仅可查看资料，填写内容仍保留在本页面。</p> : null}
        {uploading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 aria-hidden="true" className="size-4 animate-spin" />正在上传文件…</p> : null}
        {uploadError ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{uploadError}</p> : null}
        {saveError ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><p className="flex gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{saveError}</p>{conflict ? <Button type="button" variant="outline" className={`${action} mt-2`} disabled={loading || saving} onClick={() => { setConfirming(false); setRefresh((value) => value + 1); }}>读取最新版本，保留填写内容</Button> : null}</div> : null}
        {editor ? confirming ? <div className="space-y-4">
          <dl className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm"><div><dt className="text-xs text-slate-500">资料</dt><dd className="mt-1 break-words font-medium text-slate-800">{editor.title} · {categories[editor.category as RdTechnicalDocumentCategory]}</dd></div><div><dt className="text-xs text-slate-500">将登记为当前版本</dt><dd className="mt-1 break-words font-semibold text-primary">{editor.version}</dd></div><div><dt className="text-xs text-slate-500">所选文件</dt><dd className="mt-1 break-words">{selectedFile?.attachment.name || '文件已不可用，请返回选择'}</dd></div><div><dt className="text-xs text-slate-500">{editor.documentId ? '变更原因' : '登记说明'}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{editor.changeReason}</dd></div></dl>
          <DialogFooter className="gap-2"><Button type="button" variant="outline" className={action} disabled={saving} onClick={() => setConfirming(false)}>返回修改</Button><Button type="button" className={primary} disabled={saving || !canEdit || !selectedFile || newerVersion} onClick={() => void save()}>{saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Check aria-hidden="true" className="size-4" />}{saving ? '正在登记…' : saveError ? '重试确认登记' : '确认登记为当前版本'}</Button></DialogFooter>
        </div> : <form onSubmit={review} className="space-y-4">
          <fieldset disabled={saving || uploading} className="space-y-4">
            {newerVersion ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><p>当前版本已更新为 {editingDocument?.versions.find((version) => version.id === editingDocument.currentVersionId)?.version || '新版本'}。请重新核对后继续。</p><Button type="button" variant="outline" className={`${action} mt-2`} onClick={() => { setEditor((current) => current ? { ...current, expectedCurrentVersionId: editingDocument?.currentVersionId ?? undefined } : current); prepared.current = null; setSaveError(''); setConflict(false); }}>基于此当前版本继续登记</Button></div> : null}
            <label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>资料名称</span><Input className={control} required maxLength={200} value={editor.title} onChange={(event) => edit('title', event.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>资料类别</span><NativeSelect className={control} required value={editor.category} onChange={(event) => edit('category', event.target.value as Editor['category'])}><option value="">请选择类别</option>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label><label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>版本标识</span><Input className={control} required maxLength={60} value={editor.version} placeholder="按资料实际标识填写" onChange={(event) => edit('version', event.target.value)} /></label></div>
            <label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>本任务已上传文件</span><NativeSelect className={control} required value={editor.attachmentKey} onChange={(event) => edit('attachmentKey', event.target.value)}><option value="">请选择文件</option>{choices.map((choice) => <option key={choice.key} value={choice.key}>{choice.attachment.name} · {formatDate(choice.uploadedAt)}</option>)}</NativeSelect></label>
            <div className="flex flex-wrap gap-2">{selectedFile ? <Button type="button" variant="outline" className={action} onClick={() => onPreview(selectedFile.attachment)}><Eye aria-hidden="true" className="size-3.5" />核对所选文件</Button> : null}<Button type="button" variant="outline" className={action} onClick={() => upload()}><Upload aria-hidden="true" className="size-3.5" />上传新文件</Button></div>
            {!choices.length ? <p className="text-xs leading-5 text-amber-800">本任务暂无可选附件，请先上传文件。图片图纸也可以登记。</p> : null}
            <label className="block space-y-1.5 text-xs font-medium text-slate-600"><span>{editor.documentId ? '变更原因（必填）' : '登记说明（必填）'}</span><Textarea className={`${control} min-h-24 py-2`} required maxLength={2000} rows={3} value={editor.changeReason} placeholder={editor.documentId ? '说明本次变更内容及原因' : '说明资料用途及版本确认依据'} onChange={(event) => edit('changeReason', event.target.value)} /></label>
          </fieldset>
          <DialogFooter className="gap-2"><Button type="button" variant="outline" className={action} disabled={uploading} onClick={() => setEditorOpen(false)}>稍后登记</Button><Button type="submit" className={primary} disabled={!canEdit || newerVersion || uploading}>核对并确认</Button></DialogFooter>
        </form> : null}
      </DialogContent>
    </Dialog>
  </section>;
}

function fileTypeLabel(attachment: RdTaskProgressAttachment) {
  const extension = attachment.name.split('.').pop();
  return extension && extension !== attachment.name ? extension.toUpperCase() : attachment.mime || '未知';
}

function fileSizeLabel(size: number) {
  if (!Number.isFinite(size) || size < 0) return '待确认';
  if (size >= 1024 * 1024) return (size / 1024 / 1024).toFixed(1) + ' MB';
  if (size >= 1024) return Math.ceil(size / 1024) + ' KB';
  return size + ' B';
}
