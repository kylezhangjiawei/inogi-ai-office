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
      'page:rd-audit-log',
      'rd-task:edit',
      'rd-project:propose',
    ],
  },
  {
    name: '研发管理员',
    description: '研发任务管理角色：管理任务、人员、审批流和一审立项，同时保留个人工作台用于承接任务。',
    permissions: [
      'page:dashboard',
      'page:rd-my-workspace',
      'page:rd-task-management',
      'page:rd-approval-flow',
      'page:rd-audit-log',
      'page:rd-ai-settings',
      'rd-task:create',
      'rd-task:edit',
      'rd-task:archive',
      'rd-task:reassign',
      'rd-task:override-priority',
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
