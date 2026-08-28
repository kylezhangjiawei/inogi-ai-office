import { extname } from 'node:path';

const EXECUTABLE_ATTACHMENT_EXTENSIONS = new Set([
  'apk',
  'app',
  'bat',
  'cmd',
  'com',
  'dmg',
  'exe',
  'msi',
  'pkg',
  'ps1',
  'scr',
]);

const ACTIVE_CONTENT_EXTENSIONS = new Set([
  'cjs',
  'htm',
  'html',
  'js',
  'mjs',
  'svg',
  'svgz',
  'xhtml',
  'xml',
  'xsl',
  'xslt',
]);

const EXECUTABLE_ATTACHMENT_MIME_TYPES = new Set([
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'application/x-msdownload',
]);

const ACTIVE_CONTENT_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/ecmascript',
  'text/html',
  'text/javascript',
  'text/xml',
]);

function normalizedExtension(fileNameOrKey: string): string {
  return extname(fileNameOrKey.split('?')[0] ?? '').slice(1).toLocaleLowerCase('en-US');
}

function normalizedMimeType(mimeType?: string | null): string {
  return String(mimeType ?? '').split(';')[0].trim().toLocaleLowerCase('en-US');
}

/** 扩展名 → mime，仅覆盖可内联的类型；与前端 inferAttachmentMime 的兜底口径保持一致。 */
const MIME_BY_EXTENSION: Record<string, string> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webm: 'video/webm',
  webp: 'image/webp',
};

/**
 * 解析附件的有效 mime：声明值为空或 application/octet-stream 时按扩展名兜底。
 * 部分上传来源（旧数据、合并迁移、未声明 Content-Type 的客户端）会把 PDF 存成
 * octet-stream；只认声明值会让 canInlineAttachment 判否 → 服务端强制下载，
 * 前端即便按扩展名认出是 PDF 也渲染不了。
 */
export function resolveAttachmentMime(fileName: string, mimeType?: string | null): string {
  const declared = normalizedMimeType(mimeType);
  if (declared && declared !== 'application/octet-stream') return declared;
  return MIME_BY_EXTENSION[normalizedExtension(fileName)] ?? declared ?? 'application/octet-stream';
}

export function isActiveAttachmentContent(fileNameOrKey: string, mimeType?: string | null): boolean {
  return ACTIVE_CONTENT_EXTENSIONS.has(normalizedExtension(fileNameOrKey))
    || ACTIVE_CONTENT_MIME_TYPES.has(normalizedMimeType(mimeType));
}

export function isBlockedProgressAttachment(fileName: string, mimeType?: string | null): boolean {
  const extension = normalizedExtension(fileName);
  const normalizedMime = normalizedMimeType(mimeType);
  return EXECUTABLE_ATTACHMENT_EXTENSIONS.has(extension)
    || EXECUTABLE_ATTACHMENT_MIME_TYPES.has(normalizedMime)
    || ACTIVE_CONTENT_EXTENSIONS.has(extension)
    || ACTIVE_CONTENT_MIME_TYPES.has(normalizedMime);
}

export function canInlineAttachment(fileNameOrKey: string, mimeType?: string | null): boolean {
  if (isActiveAttachmentContent(fileNameOrKey, mimeType)) return false;
  const normalizedMime = normalizedMimeType(mimeType);
  return normalizedMime === 'application/pdf'
    || normalizedMime === 'application/json'
    || normalizedMime === 'text/plain'
    || normalizedMime.startsWith('image/')
    || normalizedMime.startsWith('video/');
}
