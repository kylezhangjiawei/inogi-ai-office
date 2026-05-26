export const OSS_BUSINESS_TYPES = {
  TEMP: 'temp',
  UPLOADS_TEMP: 'uploads-temp',
  IMAGES_GENERATED: 'images/generated',
  EXPENSE_INVOICES: 'expense/invoices',
  EXPENSE_VOUCHERS: 'expense/vouchers',
  RD_PROGRESS_NOTES: 'rd/progress-notes',
  RD_KNOWLEDGE: 'rd/knowledge',
  RECRUITMENT_RESUMES: 'recruitment/resumes',
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
  'recruitment/resumes': 10 * 1024 * 1024,
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
  'recruitment/resumes': [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  'assets': ['*/*'],
};

export const SIGNED_URL_TTL_SECONDS = {
  DEFAULT: 600,         // 10 minutes — for FilesModule endpoints
  DOCUMENT: 2592000,    // 30 days — for expense/RD JSON-stored links
  IMAGE_LIST: 600,      // 10 minutes — for image listing responses
} as const;
