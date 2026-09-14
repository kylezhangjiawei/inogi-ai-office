import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import type { AnswerValue, FormAnswers, FormField, FormSchema, StoredFile } from '../lib/applicantFormsApi';
import { fieldIsVisible, formSections, pruneFormAnswers, validateFormAnswers } from './form-state';
import './applicant-form-renderer.css';

export interface ApplicantFormRendererProps {
  schema: FormSchema;
  preview?: boolean;
  onSubmit?: (answers: FormAnswers) => Promise<void>;
  onUpload?: (field: FormField, file: File) => Promise<StoredFile>;
}
interface FieldInputProps {
  field: FormField; siblings: FormField[]; answers: FormAnswers; path: string; errors: Record<string, string>;
  disabled: boolean; preview: boolean; onChange: (value: AnswerValue) => void;
  onUpload?: ApplicantFormRendererProps['onUpload']; onUploading: (delta: number) => void;
}

function FieldInput({ field, siblings, answers, path, errors, disabled, preview, onChange, onUpload, onUploading }: FieldInputProps) {
  const id = useId();
  const inputId = `af-${id}`;
  const errorId = `${inputId}-error`;
  const [uploaded, setUploaded] = useState<StoredFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadLock = useRef(false);
  const value = answers[field.id];
  if (!fieldIsVisible(field, answers, siblings)) return null;
  const error = errors[path];
  const common = { id: inputId, disabled: disabled || uploading, 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId : undefined };
  const label = <>{field.label}{field.required ? <span className="af-required" aria-label="必填"> *</span> : <span className="af-optional">（选填）</span>}</>;
  const setFile = async (file?: File) => {
    if (!file || uploadLock.current) return;
    const isPhoto = field.fileKind === 'photo';
    const limitMb = isPhoto ? 5 : 10;
    if (file.size > limitMb * 1024 * 1024) { setUploadError(`单个${isPhoto ? '照片' : '附件'}不能超过 ${limitMb} MB`); return; }
    const allowedType = isPhoto
      ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      : ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type);
    if (!allowedType) { setUploadError(isPhoto ? '请选择 JPG、PNG 或 WebP 照片' : '请选择 PDF 或 Word 文档'); return; }
    setUploadError('');
    uploadLock.current = true; setUploading(true); onUploading(1);
    try {
      if (!preview && !onUpload) throw new Error('附件上传暂不可用，请稍后重试');
      const result = preview
        ? { id: `preview-${crypto.randomUUID()}`, fieldId: field.id, fileName: file.name, size: file.size, mimeType: file.type }
        : await onUpload!(field, file);
      setUploaded(result); onChange({ fileId: result.id });
    } catch (err) { setUploadError(err instanceof Error ? err.message : '附件上传失败，请重试'); }
    finally { uploadLock.current = false; setUploading(false); onUploading(-1); }
  };
  let control;
  if (field.type === 'repeat') {
    const rows = Array.isArray(value) ? value as FormAnswers[] : [];
    control = <div className="af-repeat">
      {rows.map((row, index) => <fieldset key={index} className="af-repeat-row" disabled={disabled}>
        <legend>{field.label} {index + 1}</legend>
        <button className="af-remove" type="button" aria-label={`删除${field.label}第 ${index + 1} 条`} disabled={disabled} onClick={() => onChange(rows.filter((_, at) => at !== index))}><Trash2 size={15} />删除</button>
        {(field.children ?? []).map((child) => <FieldInput key={child.id} field={child} siblings={field.children ?? []} answers={row} path={`${path}.${index}.${child.id}`} errors={errors} disabled={disabled} preview={preview} onUpload={onUpload} onUploading={onUploading}
          onChange={(next) => onChange(rows.map((item, at) => at === index ? { ...item, [child.id]: next } : item))} />)}
      </fieldset>)}
      <button type="button" className="af-add" disabled={disabled || rows.length >= (field.maxItems ?? 20)} onClick={() => onChange([...rows, {}])}><Plus size={16} />添加一条{field.label}</button>
    </div>;
  } else if (field.type === 'checkbox') {
    control = <label className="af-check-label" htmlFor={inputId}><input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
  } else if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value as string[] : [];
    control = <div className="af-options" role="group" aria-labelledby={`${inputId}-label`}>{(field.options ?? []).map((option) => <label key={option} className="af-check-label"><input disabled={disabled} type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>;
  } else if (field.type === 'select') {
    control = <select {...common} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)}><option value="">{field.placeholder || '请选择'}</option>{(field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select>;
  } else if (field.type === 'textarea') {
    control = <textarea {...common} rows={3} maxLength={5000} placeholder={field.placeholder || `请填写${field.label}`} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />;
  } else if (field.type === 'file') {
    control = <div>
      <label className={`af-upload ${uploading ? 'af-upload-busy' : ''}`} htmlFor={inputId}>
        {uploading ? <Loader2 className="af-spin" size={20} /> : uploaded ? <Paperclip size={20} /> : <Upload size={20} />}
        <span>{uploading ? '正在上传…' : value && typeof value === 'object' && 'fileId' in value ? uploaded?.id === value.fileId ? uploaded.fileName : '附件已上传，选择文件可替换' : `选择${field.fileKind === 'photo' ? '照片' : '附件'}`}</span>
        <input {...common} className="af-file-input" type="file" accept={field.fileKind === 'photo' ? 'image/jpeg,image/png,image/webp' : '.pdf,.doc,.docx'} onChange={(event) => { void setFile(event.target.files?.[0]); event.target.value = ''; }} />
      </label>
      <p className="af-field-help">{preview ? '预览时仅演示选取，不上传文件。' : ''}{field.fileKind === 'photo' ? '支持 JPG、PNG、WebP，每张不超过 5 MB。' : '支持 PDF、Word，每个文件不超过 10 MB。'}</p>
      {uploadError && <p className="af-field-error" role="alert">{uploadError}</p>}
    </div>;
  } else {
    const type = { phone: 'tel', email: 'email', number: 'number', date: 'date', text: 'text' }[field.type] || 'text';
    control = <input {...common} type={type} maxLength={1000} inputMode={type === 'tel' ? 'tel' : type === 'number' ? 'decimal' : undefined} autoComplete={field.type === 'phone' ? 'tel' : field.type === 'email' ? 'email' : 'off'}
      placeholder={field.placeholder || `请输入${field.label}`} value={typeof value === 'number' || typeof value === 'string' ? value : ''} onChange={(event) => onChange(field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />;
  }
  return <div className="af-field" data-field-path={path}>
    {field.type !== 'checkbox' && <label id={`${inputId}-label`} htmlFor={inputId} className="af-field-label">{label}</label>}
    {control}
    {error && <p id={errorId} className="af-field-error" role="alert">{error}</p>}
  </div>;
}

export function ApplicantFormRenderer({ schema, preview = false, onSubmit, onUpload }: ApplicantFormRendererProps) {
  const sections = formSections(schema);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [previewComplete, setPreviewComplete] = useState(false);
  const submitLock = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const activeStep = Math.min(step, Math.max(0, sections.length - 1));
  const current = sections[activeStep];
  const last = activeStep === sections.length - 1;
  useEffect(() => { if (preview) { setErrors({}); setPreviewComplete(false); } }, [schema, preview]);
  const focusErrors = (nextErrors: Record<string, string>) => {
    requestAnimationFrame(() => {
      const path = Object.keys(nextErrors)[0];
      const target = [...(formRef.current?.querySelectorAll<HTMLElement>('[data-field-path]') ?? [])].find((item) => item.dataset.fieldPath === path);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || uploadCount > 0 || !current) return;
    const nextErrors = validateFormAnswers(last ? schema.fields : current.fields, answers, '', schema.fields);
    setErrors(nextErrors); setRequestError('');
    if (Object.keys(nextErrors).length) {
      if (last) {
        const first = Object.keys(nextErrors)[0].split('.')[0];
        const at = sections.findIndex((section) => section.fields.some((field) => field.id === first));
        if (at >= 0) setStep(at);
      }
      focusErrors(nextErrors); return;
    }
    if (!last) { setStep(activeStep + 1); requestAnimationFrame(() => titleRef.current?.focus()); return; }
    if (preview) { setPreviewComplete(true); return; }
    if (!onSubmit) return;
    submitLock.current = true; setBusy(true);
    try { await onSubmit(pruneFormAnswers(schema.fields, answers)); }
    catch (err) { setRequestError(err instanceof Error ? err.message : '提交未完成，已保留填写内容，请重试'); }
    finally { submitLock.current = false; setBusy(false); }
  };
  return <div className={`af-renderer ${preview ? 'af-renderer-preview' : ''}`}>
    <header className="af-form-header"><strong className="af-brand">INOGI AI</strong><h1>{schema.title}</h1><p>{schema.description}</p></header>
    {sections.length > 0 ? <>
      <div className="af-progress" aria-label={`填写进度，第 ${activeStep + 1} 步，共 ${sections.length} 步`}>
        <div className="af-progress-track">{sections.map((section, index) => <span key={section.name} title={section.name} className={index <= activeStep ? 'af-progress-active' : ''}>{index < activeStep ? <Check size={13} /> : index + 1}</span>)}</div>
        <div className="af-progress-caption"><span>{current.name}</span><span>{activeStep + 1} / {sections.length}</span></div>
      </div>
      {previewComplete ? <div className="af-preview-success" role="status"><Check size={26} /><h2>填写预览已完成</h2><p>这次演示不会生成登记记录。</p><button className="af-secondary" onClick={() => { setStep(0); setPreviewComplete(false); }}>返回表单</button></div> :
        <form ref={formRef} onSubmit={(event) => void submit(event)} noValidate>
          <h2 className="af-section-title" tabIndex={-1} ref={titleRef}>{current.name}</h2>
          <div className="af-fields">{current.fields.map((field) => <FieldInput key={`${activeStep}:${field.id}`} field={field} siblings={schema.fields} answers={answers} path={field.id} errors={errors} disabled={busy || uploadCount > 0} preview={preview} onUpload={onUpload} onUploading={(delta) => setUploadCount((count) => count + delta)}
            onChange={(value) => { setAnswers((previous) => ({ ...previous, [field.id]: value })); setRequestError(''); }} />)}</div>
          {requestError && <div className="af-submit-error" role="alert">{requestError}</div>}
          <footer className="af-form-footer">
            {activeStep > 0 && <button type="button" className="af-secondary" disabled={busy || uploadCount > 0} onClick={() => { setStep(activeStep - 1); setErrors({}); }}><ArrowLeft size={16} />上一步</button>}
            <button className="af-primary" type="submit" disabled={busy || uploadCount > 0}>{busy || uploadCount > 0 ? <Loader2 className="af-spin" size={16} /> : null}{busy ? '正在提交…' : uploadCount > 0 ? '附件上传中…' : last ? preview ? '完成预览' : '确认提交' : '下一步'}{!last && <ArrowRight size={16} />}</button>
          </footer>
        </form>}
    </> : <p className="af-empty">当前阶段没有对外显示的字段，请先配置“应聘填写”内容。</p>}
  </div>;
}
