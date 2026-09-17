import { useEffect, useState } from 'react';
import { FileText, ImageOff } from 'lucide-react';
import { inferAttachmentMime } from '../components/AttachmentPreviewDialog';
import { MobileZoomableImage } from '../components/MobileZoomableImage';
import { getAttachmentPreviewUrl, type RdTaskProgressAttachment } from '../lib/rdApi';

export function technicalPreviewKind(attachment: RdTaskProgressAttachment): 'image' | 'pdf' | 'unsupported' {
  const mime = inferAttachmentMime(attachment);
  if (/\.(?:html?|svg|xml|m?js)$/i.test(attachment.name)) return 'unsupported';
  if (/^image\/(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(mime)) return 'image';
  return mime === 'application/pdf' ? 'pdf' : 'unsupported';
}

/** Same server-issued preview addresses and image surface used by the existing attachment viewer. */
export function TechnicalDocumentPreview({ attachment }: { attachment: RdTaskProgressAttachment }) {
  const kind = technicalPreviewKind(attachment);
  const source = getAttachmentPreviewUrl(attachment);
  const [failed, setFailed] = useState(false);
  const allowedSource = /^(https?:\/\/|\/(?!\/)|blob:)/i.test(source)
    || (kind === 'image' && /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)[;,]/i.test(source))
    || (kind === 'pdf' && /^data:application\/pdf[;,]/i.test(source));
  if (kind === 'unsupported') return <PreviewFallback title="此格式请打开原件查看" description="可使用文件信息中的预览或下载入口，文件与版本信息保留在当前页面。" />;
  if (!allowedSource || failed) return <PreviewFallback title={failed ? '预览加载失败' : '暂时无法显示预览'} description="可下载原文件，或刷新资料后重试。" failed />;
  if (kind === 'pdf') return <PdfPreview key={source} source={source} name={attachment.name} />;
  return <div className="relative flex h-64 min-w-0 items-center justify-center overflow-hidden bg-white sm:h-80" aria-label="图纸预览">
    <MobileZoomableImage src={source} alt={attachment.name} loading="eager" decoding="async" showControls={false} onError={() => setFailed(true)} className="h-full w-full" imageClassName="h-full w-full object-contain p-3" />
  </div>;
}

function PdfPreview({ source, name }: { source: string; name: string }) {
  const embedded = source.startsWith('data:');
  const [blobSource, setBlobSource] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!embedded) return;
    const controller = new AbortController();
    let objectUrl = '';
    void fetch(source, { signal: controller.signal }).then((response) => response.blob()).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      setBlobSource(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, embedded]);
  if (error) return <PreviewFallback title="PDF 暂时无法显示" description="可下载原文件查看，或刷新资料后重试。" failed />;
  if (embedded && !blobSource) return <div role="status" className="flex h-64 items-center justify-center bg-slate-50 text-sm text-slate-500 sm:h-80">正在读取 PDF…</div>;
  const previewSource = embedded ? blobSource : source;
  return <iframe
    // Native PDF viewing follows the existing attachment viewer: the server's preview response isolates active content.
    src={`${previewSource}${previewSource.includes('#') ? '&' : '#'}toolbar=0&navpanes=0&view=Fit`}
    title={`文件预览：${name}`}
    referrerPolicy="no-referrer"
    onError={() => setError(true)}
    className="h-64 w-full min-w-0 border-0 bg-white sm:h-80"
  />;
}

function PreviewFallback({ title, description, failed = false }: { title: string; description: string; failed?: boolean }) {
  const Icon = failed ? ImageOff : FileText;
  return <div role="status" className="flex min-w-0 flex-col items-center justify-center gap-2 bg-slate-50 px-5 py-10 text-center">
    <Icon aria-hidden="true" className="size-7 text-muted-foreground" />
    <p className="text-balance text-sm font-medium text-slate-700">{title}</p>
    <p className="max-w-xs text-pretty text-xs leading-5 text-slate-500">{description}</p>
  </div>;
}
