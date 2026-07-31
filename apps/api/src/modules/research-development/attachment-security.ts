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
