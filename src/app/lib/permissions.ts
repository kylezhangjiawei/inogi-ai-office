// Permission code constants
export const PERMISSIONS = {
  // ─── Pages ──────────────────────────────────────────────────────
  PAGE_DASHBOARD: 'page:dashboard',
  PAGE_AFTER_SALES: 'page:after-sales',
  PAGE_RD_TRIAGE: 'page:rd-triage',
  PAGE_REGISTRATION: 'page:registration-projects',
  PAGE_BOM_ARCHIVE: 'page:bom-archive',
  PAGE_DESIGN_CHANGES: 'page:design-changes',
  PAGE_CUSTOMS_AI: 'page:customs-ai',
  PAGE_CUSTOMS_DOCS: 'page:customs-docs',
  PAGE_EXTERNAL_DOCS: 'page:external-docs',
  PAGE_RA_KNOWLEDGE: 'page:ra-knowledge',
  PAGE_QUALITY_DMS: 'page:quality-dms',
  PAGE_QA_TRACEABILITY: 'page:qa-traceability',
  PAGE_ORDER_WORKBENCH: 'page:order-workbench',
  PAGE_PURCHASE_ORDERS: 'page:purchase-orders',
  PAGE_PURCHASE_ORDER_DETAIL: 'page:purchase-order-detail',
  PAGE_INVENTORY_MANAGEMENT: 'page:inventory-management',
  PAGE_PROC_COCKPIT: 'page:proc-cockpit',
  PAGE_PROC_CATEGORY: 'page:proc-category',
  PAGE_PROC_MATERIALS: 'page:proc-materials',
  PAGE_RESUME_SCREENING: 'page:resume-screening',
  PAGE_EMPLOYEE_ARCHIVE: 'page:employee-archive',
  PAGE_ATTENDANCE: 'page:quick-capture',
  /** @deprecated 使用 PAGE_ATTENDANCE；保留旧名称以兼容现有调用。 */
  PAGE_QUICK_CAPTURE: 'page:quick-capture',
  PAGE_EXPENSE_CENTER: 'page:expense-center',
  PAGE_EBPR: 'page:ebpr',
  PAGE_INSPECTION_RELEASE: 'page:inspection-release',
  PAGE_BUG_LOG: 'page:bug-log',
  PAGE_CONTRACT_REVIEW: 'page:contract-review',
  PAGE_MAILBOX_MANAGEMENT: 'page:mailbox-management',
  PAGE_AI_MODEL_MANAGEMENT: 'page:ai-model-management',
  PAGE_OCR_CONFIG_MANAGEMENT: 'page:ocr-config-management',
  PAGE_OPS_CENTER: 'page:ops-center',
  PAGE_OPS_API_ERRORS: 'page:ops-api-errors',
  PAGE_OPS_DATABASE: 'page:ops-database',
  PAGE_OPS_SERVICES_TASKS: 'page:ops-services-tasks',
  PAGE_OPS_ALERTS_AUDIT: 'page:ops-alerts-audit',
  PAGE_DOWNLOADS: 'page:downloads',
  PAGE_DEPARTMENTS: 'page:departments',
  PAGE_USERS: 'page:users',
  PAGE_ROLES: 'page:roles',
  PAGE_ROUTE_MANAGEMENT: 'page:route-management',
  PAGE_SETTINGS: 'page:settings',
  PAGE_INQUIRY: 'page:inquiry',
  PAGE_MEETING: 'page:meeting',
  PAGE_EMAIL_AI: 'page:email-ai',
  PAGE_REPORT_COMPRESSION: 'page:report-compression',

  // ─── R&D Task Management ─────────────────────────────────────────
  PAGE_RD_TASK_MANAGEMENT: 'page:rd-task-management',
  PAGE_RD_MY_WORKSPACE: 'page:rd-my-workspace',
  PAGE_US_COLLAB_COCKPIT: 'page:us-collab-cockpit',
  PAGE_US_COLLAB_WORKSPACE: 'page:us-collab-workspace',
  PAGE_US_COLLAB_KB: 'page:dept-kb-us-collab',
  PAGE_RD_SHEET: 'page:rd-sheet',
  PAGE_RD_DIRECTOR_DASHBOARD: 'page:rd-director-dashboard',
  PAGE_RD_APPROVAL_FLOW: 'page:rd-approval-flow',
  PAGE_RD_AUDIT_LOG: 'page:rd-audit-log',
  PAGE_RD_AI_SETTINGS: 'page:rd-ai-settings',
  RD_TASK_CREATE: 'rd-task:create',
  RD_TASK_EDIT: 'rd-task:edit',
  RD_TASK_ARCHIVE: 'rd-task:archive',
  RD_TASK_REASSIGN: 'rd-task:reassign',
  RD_TASK_MOVE: 'rd-task:move',
  RD_TASK_OVERRIDE_PRIORITY: 'rd-task:override-priority',
  RD_PEOPLE_MANAGE: 'rd-people:manage',
  RD_APPROVAL_FLOW_MANAGE: 'rd-approval-flow:manage',
  RD_AUDIT_CLEAR: 'rd-audit:clear',
  RD_DATA_CLEAR: 'rd-data:clear',
  RD_AI_CONFIGURE: 'rd-ai:configure',
  /** 编辑研发数据表；拥有此权限即可见全量数据（不受行级密级裁剪） */
  RD_SHEET_EDIT: 'rd-sheet:edit',

  // 立项流程
  RD_PROJECT_PROPOSE: 'rd-project:propose',
  RD_PROJECT_REVIEW_L1: 'rd-project:review-l1',
  RD_PROJECT_REVIEW_L2: 'rd-project:review-l2',
  RD_PROJECT_DIRECT: 'rd-project:direct',

  // ─── R&D Knowledge Base ─────────────────────────────────────────
  PAGE_RD_KNOWLEDGE_BASE: 'page:rd-knowledge-base',
  RD_KB_UPLOAD: 'rd-kb:upload',
  RD_KB_ENTRY_EDIT: 'rd-kb:entry:edit',
  RD_KB_ENTRY_DELETE: 'rd-kb:entry:delete',
  RD_KB_ENTRY_MOVE: 'rd-kb:entry:move',
  RD_KB_CATEGORY_CREATE: 'rd-kb:category:create',
  RD_KB_CATEGORY_EDIT: 'rd-kb:category:edit',
  RD_KB_CATEGORY_DELETE: 'rd-kb:category:delete',
  /** @deprecated 旧的笼统权限，保留向后兼容；新接口请用上面细分的 entry/category 权限 */
  RD_KB_MANAGE: 'rd-kb:manage',

  // ─── User management ────────────────────────────────────────────
  USER_CREATE: 'user:create',
  USER_EDIT: 'user:edit',
  USER_DISABLE: 'user:disable',
  USER_DELETE: 'user:delete',
  USER_RESET_PASSWORD: 'user:reset-password',

  // ─── Department management ──────────────────────────────────────
  DEPARTMENT_CREATE: 'department:create',
  DEPARTMENT_EDIT: 'department:edit',
  DEPARTMENT_DELETE: 'department:delete',

  // ─── Role management ────────────────────────────────────────────
  ROLE_CREATE: 'role:create',
  ROLE_EDIT: 'role:edit',
  ROLE_DELETE: 'role:delete',

  // ─── After-sales ────────────────────────────────────────────────
  AFTER_SALES_CREATE: 'after-sales:create',
  AFTER_SALES_EDIT: 'after-sales:edit',
  AFTER_SALES_DELETE: 'after-sales:delete',
  AFTER_SALES_APPROVE: 'after-sales:approve',

  // ─── Resume screening ───────────────────────────────────────────
  RESUME_UPLOAD: 'resume:upload',
  RESUME_SCREEN: 'resume:screen',
  RESUME_DELETE: 'resume:delete',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];


// ─── Helper functions ────────────────────────────────────────────────────────

/** Returns true if userPermissions grants the requested permission. */
export function hasPermission(userPermissions: string[], permission: string): boolean {
  if (userPermissions.includes('*')) return true;
  return userPermissions.includes(permission);
}

/** Returns true if userPermissions grants ANY of the requested permissions. */
export function hasAnyPermission(userPermissions: string[], permissions: string[]): boolean {
  if (userPermissions.includes('*')) return true;
  return permissions.some((p) => userPermissions.includes(p));
}

/** 超级管理员 = 拥有通配符权限 '*' 的用户。 */
export function isSuperAdmin(userPermissions: string[] | null | undefined): boolean {
  return Array.isArray(userPermissions) && userPermissions.includes('*');
}
