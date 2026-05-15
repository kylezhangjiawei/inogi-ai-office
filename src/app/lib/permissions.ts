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
  PAGE_RESUME_SCREENING: 'page:resume-screening',
  PAGE_EMPLOYEE_ARCHIVE: 'page:employee-archive',
  PAGE_QUICK_CAPTURE: 'page:quick-capture',
  PAGE_EXPENSE_CENTER: 'page:expense-center',
  PAGE_EBPR: 'page:ebpr',
  PAGE_INSPECTION_RELEASE: 'page:inspection-release',
  PAGE_BUG_LOG: 'page:bug-log',
  PAGE_CONTRACT_REVIEW: 'page:contract-review',
  PAGE_MAILBOX_MANAGEMENT: 'page:mailbox-management',
  PAGE_AI_MODEL_MANAGEMENT: 'page:ai-model-management',
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
  PAGE_RD_DIRECTOR_DASHBOARD: 'page:rd-director-dashboard',
  PAGE_RD_APPROVAL_FLOW: 'page:rd-approval-flow',
  PAGE_RD_AUDIT_LOG: 'page:rd-audit-log',
  PAGE_RD_AI_SETTINGS: 'page:rd-ai-settings',
  RD_TASK_CREATE: 'rd-task:create',
  RD_TASK_EDIT: 'rd-task:edit',
  RD_TASK_ARCHIVE: 'rd-task:archive',
  RD_TASK_REASSIGN: 'rd-task:reassign',
  RD_TASK_OVERRIDE_PRIORITY: 'rd-task:override-priority',
  RD_PEOPLE_MANAGE: 'rd-people:manage',
  RD_APPROVAL_FLOW_MANAGE: 'rd-approval-flow:manage',
  RD_AUDIT_CLEAR: 'rd-audit:clear',
  RD_AI_CONFIGURE: 'rd-ai:configure',

  // 立项流程
  RD_PROJECT_PROPOSE: 'rd-project:propose',
  RD_PROJECT_REVIEW_L1: 'rd-project:review-l1',
  RD_PROJECT_REVIEW_L2: 'rd-project:review-l2',
  RD_PROJECT_DIRECT: 'rd-project:direct',

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
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Permission group definitions used in the role editor UI
export type PermissionGroup = {
  label: string;
  permissions: { code: string; label: string; description?: string }[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: '页面访问 · 系统管理',
    permissions: [
      { code: 'page:users', label: '用户管理', description: '查看用户列表页面' },
      { code: 'page:departments', label: '部门管理', description: '查看部门主数据页面' },
      { code: 'page:roles', label: '角色权限', description: '查看角色权限页面' },
      { code: 'page:route-management', label: '页面路由管理', description: '维护页面与按钮权限目录' },
      { code: 'page:settings', label: '字典配置', description: '查看系统字典页面' },
      { code: 'page:mailbox-management', label: '邮箱管理', description: '邮箱集成管理页面' },
      { code: 'page:ai-model-management', label: 'AI 模型管理', description: 'AI 模型配置页面' },
      { code: 'page:downloads', label: '下载和教程', description: '查看下载与教程页面' },
    ],
  },
  {
    label: '页面访问 · 系统运维中心',
    permissions: [
      { code: 'page:ops-center', label: '运维总览', description: '查看运维总览、核心指标、错误趋势与二期接入状态' },
      { code: 'page:ops-api-errors', label: '接口与错误', description: '查看接口日志、请求详情、错误聚合与处理建议' },
      { code: 'page:ops-database', label: '数据库监控', description: '查看数据库连接、慢查询、锁等待、容量与 RDS/ECS 状态' },
      { code: 'page:ops-services-tasks', label: '服务与任务', description: '查看第三方服务、阿里云集成与业务任务日志' },
      { code: 'page:ops-alerts-audit', label: '告警与审计设置', description: '查看告警规则、日志策略、脱敏设置与操作审计' },
    ],
  },
  {
    label: '操作权限 · 部门管理',
    permissions: [
      { code: 'department:create', label: '新建部门', description: '创建公司部门主数据' },
      { code: 'department:edit', label: '编辑部门', description: '修改部门信息与启停状态' },
      { code: 'department:delete', label: '删除部门', description: '删除未被用户使用的部门' },
    ],
  },
  {
    label: '操作权限 · 用户管理',
    permissions: [
      { code: 'user:create', label: '新建用户', description: '创建新用户账号' },
      { code: 'user:edit', label: '编辑用户', description: '修改用户基本信息' },
      { code: 'user:disable', label: '启用/停用用户', description: '切换用户账号状态' },
      { code: 'user:delete', label: '删除用户', description: '永久删除用户账号' },
      { code: 'user:reset-password', label: '重置密码', description: '管理员重置用户密码' },
    ],
  },
  {
    label: '操作权限 · 角色管理',
    permissions: [
      { code: 'role:create', label: '新建角色', description: '创建新角色' },
      { code: 'role:edit', label: '编辑角色', description: '修改角色权限配置' },
      { code: 'role:delete', label: '删除角色', description: '永久删除角色' },
    ],
  },
  {
    label: '页面访问 · 信息流转',
    permissions: [
      { code: 'page:after-sales', label: '售后 Case 管理' },
      { code: 'page:rd-triage', label: '研发问题分流' },
      { code: 'page:registration-projects', label: '注册项目里程碑' },
      { code: 'page:bom-archive', label: 'BOM 确认存档' },
      { code: 'page:design-changes', label: '设计开发变更' },
    ],
  },
  {
    label: '操作权限 · 售后工单',
    permissions: [
      { code: 'after-sales:create', label: '新建工单' },
      { code: 'after-sales:edit', label: '编辑工单' },
      { code: 'after-sales:delete', label: '删除工单' },
      { code: 'after-sales:approve', label: '审批工单' },
    ],
  },
  {
    label: '页面访问 · 文件与知识',
    permissions: [
      { code: 'page:customs-ai', label: '报关单证 AI' },
      { code: 'page:customs-docs', label: '报关单证处理' },
      { code: 'page:external-docs', label: '对外资料版本' },
      { code: 'page:ra-knowledge', label: '法规知识库' },
      { code: 'page:quality-dms', label: '质量文件 DMS' },
      { code: 'page:qa-traceability', label: '全链路追溯' },
    ],
  },
  {
    label: '页面访问 · 沟通协同',
    permissions: [
      { code: 'page:inquiry', label: '多渠道询盘' },
      { code: 'page:meeting', label: '会议纪要' },
      { code: 'page:email-ai', label: '邮件 AI 写作' },
      { code: 'page:report-compression', label: '汇报材料压缩' },
    ],
  },
  {
    label: '页面访问 · 人事行政',
    permissions: [
      { code: 'page:resume-screening', label: '简历筛选' },
      { code: 'page:employee-archive', label: '员工入职归档' },
      { code: 'page:quick-capture', label: '随手记任务分流' },
      { code: 'page:expense-center', label: '费用报销统计' },
    ],
  },
  {
    label: '操作权限 · 简历筛选',
    permissions: [
      { code: 'resume:upload', label: '上传简历' },
      { code: 'resume:screen', label: '执行 AI 筛选' },
    ],
  },
  {
    label: '页面访问 · 质量与生产',
    permissions: [
      { code: 'page:ebpr', label: '电子批记录' },
      { code: 'page:inspection-release', label: '检验与放行' },
      { code: 'page:bug-log', label: 'BUG 日志分析' },
    ],
  },
  {
    label: '页面访问 · 法务管理',
    permissions: [
      { code: 'page:contract-review', label: '合同 AI 审查' },
    ],
  },
  {
    label: '页面访问 · 总览',
    permissions: [
      { code: 'page:dashboard', label: '系统首页' },
    ],
  },
  {
    label: '页面访问 · 研发任务管理',
    permissions: [
      { code: 'page:rd-task-management', label: '研发任务管理', description: '树状任务表，AI 解析新建，任务封存/移交' },
      { code: 'page:rd-my-workspace', label: '个人工作台', description: '我的任务、协作任务、今日待办、待审核 AI 建议' },
      { code: 'page:rd-director-dashboard', label: '厂长驾驶舱', description: '全局进度、人员负载热力图、批量重分配（高级权限）' },
      { code: 'page:rd-approval-flow', label: '审批流配置', description: '配置立项/任务审批的节点、模式、SLA' },
      { code: 'page:rd-audit-log', label: '操作留痕', description: '查看研发任务管理关键操作的审计时间轴' },
      { code: 'page:rd-ai-settings', label: '研发 AI 策略', description: '配置研发模块 AI 场景模型、文件解析顺序、OCR 兜底与披露策略' },
    ],
  },
  {
    label: '操作权限 · 研发任务管理',
    permissions: [
      { code: 'rd-task:create', label: '新建任务', description: '通过 AI 解析或手动创建任务' },
      { code: 'rd-task:edit', label: '编辑任务', description: '修改任务字段和状态' },
      { code: 'rd-task:archive', label: '封存/解封任务', description: '触发任务封存或解除封存（需审批）' },
      { code: 'rd-task:reassign', label: '转派任务', description: '批量或单条任务重分配（高级权限）' },
      { code: 'rd-task:override-priority', label: '覆盖优先级', description: '覆盖 AI 判定的优先级（组长及以上）' },
      { code: 'rd-people:manage', label: '管理研发人员', description: '新增、编辑、删除研发成员和任务容量' },
      { code: 'rd-approval-flow:manage', label: '管理审批流', description: '新增、调整、保存、重置研发审批流节点' },
      { code: 'rd-audit:clear', label: '清空操作留痕', description: '清空研发任务管理操作留痕记录' },
      { code: 'rd-ai:configure', label: '配置研发 AI 策略', description: '维护研发模块各 AI 场景模型、OCR 兜底、文件解析和人工确认策略' },
    ],
  },
  {
    label: '操作权限 · 立项流程',
    permissions: [
      { code: 'rd-project:propose', label: '立项申请', description: '提交立项需求，进入审核队列' },
      { code: 'rd-project:review-l1', label: '立项一审', description: '研发管理员审核立项（多级中的第一级）' },
      { code: 'rd-project:review-l2', label: '立项终审', description: '厂长 / 总监终审通过立项' },
      { code: 'rd-project:direct', label: '直接立项', description: '跳过审核，直接生效并自动分配（厂长/管理员）' },
    ],
  },
];

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
