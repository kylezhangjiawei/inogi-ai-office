import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';

const MB = 1024 * 1024;
function setting(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 1 ? Math.min(max, Math.floor(value)) : fallback;
}
/** ZIP32 / FileAsset Int 边界内的高容量上限；总量包含原文件，不包含少量 ZIP 目录开销。 */
export function archiveLimits() {
  return {
    maxFiles: setting('CHAT_ARCHIVE_MAX_FILES', 2000, 10000),
    maxBytes: setting('CHAT_ARCHIVE_MAX_MB', 1900, 1900) * MB,
    maxFileBytes: setting('CHAT_ARCHIVE_MAX_FILE_MB', 512, 1900) * MB,
    concurrency: setting('CHAT_ARCHIVE_CONCURRENCY', 2, 4),
    perUser: setting('CHAT_ARCHIVE_USER_CONCURRENCY', 3, 10),
    timeoutMs: setting('CHAT_ARCHIVE_TIMEOUT_MINUTES', 30, 120) * 60000,
    retentionMs: setting('CHAT_ARCHIVE_RETENTION_HOURS', 24, 168) * 3600000,
  };
}
export function safeArchiveName(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  const ext = extname(cleaned).slice(0, 20);
  const chars = Array.from(cleaned.slice(0, cleaned.length - extname(cleaned).length));
  while (Buffer.byteLength(chars.join('') + ext, 'utf8') > 180) chars.pop();
  const name = (chars.join('') + ext) || '文件';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
export function uniqueArchivePath(folder: string, filename: string, used: Set<string>): string {
  const parts = folder.split('/').filter(Boolean).map(safeArchiveName).slice(0, 6);
  const name = safeArchiveName(filename);
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);
  let path = [...parts, name].join('/');
  let seq = 1;
  while (used.has(path.toLowerCase())) path = [...parts, `${base} (${++seq})${ext}`].join('/');
  used.add(path.toLowerCase());
  return path;
}
export function csv(rows: unknown[][]): string {
  const cell = (value: unknown) => {
    let str = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(str)) str = `'${str}`;
    return `"${str.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
export function stringIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new BadRequestException('文件或检索编号列表无效');
  return [...new Set(value as string[])];
}
