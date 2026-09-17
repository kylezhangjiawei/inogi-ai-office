import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, FileQuestion, Loader2 } from 'lucide-react';
import { ApplicantFormsError, getPublicApplicantForm, submitPublicApplicantForm, uploadPublicApplicantFile, type FormAnswers, type FormField, type PublicForm, type SubmitReceipt } from '../lib/applicantFormsApi';
import { ApplicantFormRenderer } from './ApplicantFormRenderer';
import { Button } from "../components/ui/button";

function newSubmissionKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('无法读取文件，请重新选择'));
    reader.readAsDataURL(file);
  });
}

export function PublicApplicantFormPage() {
  const { slug = '' } = useParams();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const submissionKey = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    setForm(null); setReceipt(null); setError('');
    submissionKey.current = newSubmissionKey();
    void getPublicApplicantForm(slug, controller.signal).then((result) => {
      if (!controller.signal.aborted) setForm(result);
    }).catch((err) => {
      if (controller.signal.aborted) return;
      setError(err instanceof ApplicantFormsError && err.status === 404
        ? '此登记表尚未发布或链接已失效，请联系行政获取有效链接。'
        : err instanceof Error ? err.message : '暂时无法打开登记表，请稍后重试。');
    });
    return () => controller.abort();
  }, [slug, reload]);

  const upload = async (field: FormField, file: File) => {
    if (!form) throw new Error('登记表尚未加载完成');
    if (file.size > form.uploadLimits.maxFileBytes) throw new Error(`单个附件不能超过 ${Math.floor(form.uploadLimits.maxFileBytes / 1024 / 1024)} MB`);
    return uploadPublicApplicantFile(slug, { versionId: form.versionId, fillToken: form.fillToken, fieldId: field.id, fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: await fileToBase64(file) });
  };
  const submit = async (answers: FormAnswers) => {
    if (!form) return;
    // 重试始终沿用本次填写的版本和幂等键，不把已填答案静默迁移到新发布的模板。
    const result = await submitPublicApplicantForm(slug, { versionId: form.versionId, fillToken: form.fillToken, idempotencyKey: submissionKey.current, answers });
    setReceipt(result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return <main className="af-public-page">
    <div className="af-public-sheet">
      {receipt ? <section className="af-public-feedback" role="status"><CheckCircle2 size={48} /><h1>登记已提交</h1><p>感谢填写，我们已收到你的资料。<br />请保持联系电话畅通，行政会按招聘安排与你联系。</p>
        <dl className="af-receipt"><div><dt>登记编号</dt><dd>{receipt.id}</dd></div><div><dt>表单版本</dt><dd>V{receipt.version}</dd></div><div><dt>提交时间</dt><dd>{new Date(receipt.submittedAt).toLocaleString('zh-CN')}</dd></div></dl>
      </section> : error ? <section className="af-public-feedback" role="alert"><FileQuestion size={44} /><h1>暂时无法填写</h1><p>{error}</p><Button variant="unstyled" className="af-secondary" onClick={() => setReload((count) => count + 1)}>重新加载</Button></section>
        : form ? <><ApplicantFormRenderer key={form.fillToken} schema={form.schema} onUpload={upload} onSubmit={submit} /><div className="af-public-meta"><span>INOGI · 应聘登记</span><span>表单版本 V{form.version}</span></div></>
          : <section className="af-public-feedback" role="status"><Loader2 className="af-spin" size={30} /><p>正在加载登记表…</p></section>}
    </div>
  </main>;
}
