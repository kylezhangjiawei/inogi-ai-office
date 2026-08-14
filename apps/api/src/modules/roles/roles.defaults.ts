export type DefaultRole = {
  name: string;
  description: string;
  permissions: string[];
};

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: '研发人员',
    description: '研发任务执行角色：查看个人工作台与任务看板，更新本人任务进展，提交立项申请。',
    permissions: [
      'page:dashboard',
      'page:rd-my-workspace',
      'page:rd-task-management',
      'page:rd-sheet',
      'page:rd-audit-log',
      'rd-task:edit',
      'rd-project:propose',
      'proc-task:transfer',
    ],
  },
  {
    name: '研发管理员',
    description: '研发任务管理角色：管理任务、人员、审批流和一审立项，同时保留个人工作台用于承接任务。',
    permissions: [
      'page:dashboard',
      'page:rd-my-workspace',
      'page:rd-task-management',
      'page:rd-sheet',
      'page:rd-approval-flow',
      'page:rd-audit-log',
      'page:rd-ai-settings',
      'rd-task:create',
      'rd-sheet:edit',
      'rd-task:edit',
      'rd-task:archive',
      'rd-task:reassign',
      'rd-task:override-priority',
      // 新装默认只给管理员：审核通知就该落在真正负责审核的岗位上。
      // 存量环境由迁移 20260813150000 按旧口径平移，可能比这里更宽，之后在界面上收敛。
      'rd-task:review-notify',
      'proc-task:transfer',
      'rd-procurement:review',
      'rd-people:manage',
      'rd-approval-flow:manage',
      'rd-audit:clear',
      'rd-ai:configure',
      'rd-project:propose',
      'rd-project:review-l1',
      'rd-project:direct',
    ],
  },
];
