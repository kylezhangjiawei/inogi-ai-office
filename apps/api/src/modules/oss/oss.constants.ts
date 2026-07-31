export const OSS_BUSINESS_TYPES = {
  TEMP: 'temp',
  UPLOADS_TEMP: 'uploads-temp',
  IMAGES_GENERATED: 'images/generated',
  EXPENSE_INVOICES: 'expense/invoices',
  EXPENSE_VOUCHERS: 'expense/vouchers',
  RD_PROGRESS_NOTES: 'rd/progress-notes',
  RD_KNOWLEDGE: 'rd/knowledge',
  RD_SHEET_IMAGES: 'rd/sheet-images',
  RECRUITMENT_RESUMES: 'recruitment/resumes',
  ISSUE_ATTACHMENTS: 'issue/attachments',
  EMPLOYEE_BADGE_AVATAR: 'employee-archive/badge-avatar',
  EXTERNAL_DOCS: 'external-docs',
  CONTENT_SLOTS_STATIC: 'content-slots-static',
  ASSETS: 'assets',
} as const;

export type OssBusinessType = (typeof OSS_BUSINESS_TYPES)[keyof typeof OSS_BUSINESS_TYPES];

export const OSS_MAX_FILE_SIZE: Record<OssBusinessType, number> = {
  'temp': 20 * 1024 * 1024,
  'uploads-temp': 20 * 1024 * 1024,
  'images/generated': 10 * 1024 * 1024,
  'expense/invoices': 10 * 1024 * 1024,
  'expense/vouchers': 10 * 1024 * 1024,
  'rd/progress-notes': 50 * 1024 * 1024,
  'rd/knowledge': 50 * 1024 * 1024,
  'rd/sheet-images': 10 * 1024 * 1024,
  'recruitment/resumes': 10 * 1024 * 1024,
  'issue/attachments': 20 * 1024 * 1024,
  'employee-archive/badge-avatar': 5 * 1024 * 1024,
  'external-docs': 25 * 1024 * 1024,
  'content-slots-static': 10 * 1024 * 1024,
  'assets': 50 * 1024 * 1024,
};

export const OSS_ALLOWED_MIME_TYPES: Record<OssBusinessType, string[]> = {
  'temp': ['*/*'],
  'uploads-temp': ['*/*'],
  'images/generated': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  'expense/invoices': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  'expense/vouchers': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  'rd/progress-notes': [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  'rd/knowledge': [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
  'rd/sheet-images': ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'],
  'recruitment/resumes': [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  'issue/attachments': ['*/*'],
  'employee-archive/badge-avatar': ['image/jpeg', 'image/png', 'image/webp'],
  'external-docs': ['*/*'],
  'content-slots-static': ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  'assets': ['*/*'],
};

export const SIGNED_URL_TTL_SECONDS = {
  DEFAULT: 86400,       // 24 hours — stable URLs let browser disk cache survive route changes
  DOCUMENT: 2592000,    // 30 days — for expense/RD JSON-stored links
  IMAGE_LIST: 600,      // 10 minutes — for image listing responses
} as const;

// ── 分片上传（Multipart Upload）的 OSS 协议常量 ──────────────────────────
// 前两个是 OSS 服务端的硬性约束，第三个是可调策略值。

/** 分片上传的分片数上限 */
export const OSS_MAX_MULTIPART_PARTS = 10000;
/** 分片上传单片大小上限 5GB */
export const OSS_MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;
/**
 * 默认分片大小 32MB —— 这个是策略值，可调。
 * 15GB / 32MB ≈ 480 片，离 10000 片上限很远；按此片大小，理论可传到 320GB。
 * 超过 320GB 时 pickPartSize 会翻倍片大小，最多翻到 4GB（8GB 会超单片 5GB 上限），
 * 故本实现的文件上限 = 4GB × 10000 片 = 40TB，前端 KB_MAX_UPLOAD_BYTES 与此对齐。
 */
export const OSS_DEFAULT_PART_BYTES = 32 * 1024 * 1024;
