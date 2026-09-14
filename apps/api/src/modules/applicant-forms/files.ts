import { BadRequestException } from '@nestjs/common';
import { FormField } from './types';
import { text } from './schema';

export const UPLOAD_LIMITS = { maxFileBytes: 10 * 1024 * 1024, maxSessionBytes: 25 * 1024 * 1024, maxFiles: 8 };
export const IP_DAILY_BYTES = 100 * 1024 * 1024;
export const GLOBAL_DAILY_BYTES = 1024 * 1024 * 1024;

/** An allowlist intentionally excludes SVG, HTML and executables. Objects are always private. */
export function validateUpload(input: Record<string, unknown>, field: FormField) {
  const fileName = text(input.fileName, '文件名', 180);
  if (/[\\/\x00-\x1f\x7f]/.test(fileName)) throw new BadRequestException('文件名不能包含路径或控制字符');
  const mimeType = text(input.mimeType, '文件类型', 100).toLowerCase();
  const encoded = input.dataBase64;
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(UPLOAD_LIMITS.maxFileBytes / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new BadRequestException('附件编码无效或超过 10 MB');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new BadRequestException('附件编码无效');
  if (!bytes.length || bytes.length > UPLOAD_LIMITS.maxFileBytes) throw new BadRequestException('附件大小必须在 1 字节至 10 MB 之间');
  const ext = fileName.split('.').pop()?.toLowerCase();
  const magic: Record<string, boolean> = {
    'image/jpeg': ['jpg', 'jpeg'].includes(ext ?? '') && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
    'image/png': ext === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/webp': ext === 'webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
    'application/pdf': ext === 'pdf' && bytes.toString('ascii', 0, 5) === '%PDF-',
    'application/msword': ext === 'doc' && bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ext === 'docx' && bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')),
  };
  if (!magic[mimeType]) throw new BadRequestException('仅支持真实的 JPG、PNG、WebP、PDF、DOC 或 DOCX 文件');
  if (field.fileKind === 'photo' && (!mimeType.startsWith('image/') || bytes.length > 5 * 1024 * 1024)) {
    throw new BadRequestException('照片仅支持 JPG、PNG、WebP，且不能超过 5 MB');
  }
  if (field.fileKind === 'document' && mimeType.startsWith('image/')) throw new BadRequestException('此字段需要 PDF、DOC 或 DOCX 文档');
  return { bytes, fileName, mimeType, extension: ext! };
}
