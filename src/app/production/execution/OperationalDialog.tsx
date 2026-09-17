import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { NativeSelect } from '../../components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';

export interface OperationField { key: string; label: string; type?: 'text' | 'number' | 'date' | 'textarea' | 'checkbox'; value?: string; optional?: boolean; min?: number; options?: { value: string; label: string }[] }
export interface OperationEditor { title: string; description: string; fields: OperationField[]; submit: (data: Record<string, unknown>, requestId: string) => Promise<unknown> }
/** Keeps a failed command's draft and request ID, including uncertain network responses. */
export function OperationalDialog({ editor, onClose, onSaved }: { editor: OperationEditor; onClose: () => void; onSaved: () => void }) {
  const id = useId(), initial = Object.fromEntries(editor.fields.map(field => [field.key, field.type === 'checkbox' ? false : field.value ?? (field.type === 'date' ? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) : '')]));
  const [values, setValues] = useState<Record<string, string | boolean>>(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [discard, setDiscard] = useState(false);
  const request = useRef({ signature: '', id: '' }), locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => { if (!locked.current) JSON.stringify(values) === JSON.stringify(initial) ? onClose() : setDiscard(true); };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current) return;
    try {
      const data = Object.fromEntries(editor.fields.map(field => {
        const raw = values[field.key];
        if (!field.optional && (raw === '' || raw === false)) throw new Error(`请填写或确认${field.label}`);
        if (field.type === 'number' && raw !== '' && !Number.isFinite(Number(raw))) throw new Error(`${field.label}无效`);
        return [field.key, field.type === 'number' && raw !== '' ? Number(raw) : raw];
      }));
      const signature = JSON.stringify(data);
      if (signature !== request.current.signature) request.current = { signature, id: crypto.randomUUID() };
      locked.current = true; setBusy(true); setError('');
      await editor.submit(data, request.current.id); if (mounted.current) onSaved();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '提交失败，请保留填写内容重试'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{editor.title}</DialogTitle><DialogDescription>{editor.description}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-5"><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">{editor.fields.map(field => <div key={field.key} className={field.type === 'textarea' || field.type === 'checkbox' ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
      <Label htmlFor={`${id}-${field.key}`}>{field.label}{field.optional ? '（选填）' : ''}</Label>
      {field.type === 'checkbox' ? <Checkbox id={`${id}-${field.key}`} className="ml-3" disabled={busy} checked={values[field.key] === true} required={!field.optional} onCheckedChange={checked => setValues(previous => ({ ...previous, [field.key]: checked === true }))} /> : field.options ? <NativeSelect id={`${id}-${field.key}`} value={String(values[field.key])} required={!field.optional} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))}><option value="">请选择</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect> : field.type === 'textarea' ? <Textarea id={`${id}-${field.key}`} maxLength={2000} required={!field.optional} value={String(values[field.key])} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} /> : <Input id={`${id}-${field.key}`} type={field.type ?? 'text'} step={field.type === 'number' ? '0.001' : undefined} min={field.type === 'number' ? field.min ?? 0 : undefined} maxLength={200} required={!field.optional} value={String(values[field.key])} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} />}
    </div>)}</fieldset>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button><Button disabled={busy}>{busy ? '正在保存…' : '确认保存'}</Button></DialogFooter></form>
  </DialogContent></Dialog><AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>放弃尚未保存的内容？</AlertDialogTitle><AlertDialogDescription>关闭后本次填写将丢失。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>继续填写</AlertDialogCancel><AlertDialogAction onClick={onClose}>放弃填写</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
