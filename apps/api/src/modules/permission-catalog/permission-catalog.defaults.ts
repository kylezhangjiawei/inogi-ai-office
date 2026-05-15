export type DefaultPermissionCatalogItem = {
  code: string;
  label: string;
  description?: string;
  groupLabel: string;
  type: 'page' | 'action';
  routePath?: string;
  sortOrder: number;
};

export const DEFAULT_PERMISSION_CATALOG: DefaultPermissionCatalogItem[] = [
  { code: 'page:dashboard', label: '系统首页', description: '查看系统首页', groupLabel: '页面访问 · 总览', type: 'page', routePath: '/', sortOrder: 10 },

  // ─── 研发任务管理 ───────────────────────────────────────────────────────────
  { code: 'page:rd-task-management', label: '研发任务驾驶舱', description: '树状任务表 · AI 解析新建 · 任务封存/移交', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-task-management', sortOrder: 50 },
  { code: 'page:rd-my-workspace', label: '个人工作台', description: '我的任务、协作任务、今日待办、待审核 AI 建议', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-my-workspace', sortOrder: 60 },
  { code: 'page:rd-director-dashboard', label: '厂长驾驶舱', description: '全局进度、人员负载热力图、批量重分配（高级权限）', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-director-dashboard', sortOrder: 70 },
  { code: 'page:rd-approval-flow', label: '审批流配置', description: '配置立项/任务审批的节点、模式、SLA', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-approval-flow', sortOrder: 75 },
  { code: 'page:rd-audit-log', label: '操作留痕', description: '查看研发任务管理关键操作的审计时间轴', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-audit-log', sortOrder: 76 },
  { code: 'page:rd-ai-settings', label: '研发 AI 策略', description: '配置研发模块 AI 场景模型、文件解析顺序、OCR 兜底与披露策略', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-ai-settings', sortOrder: 77 },

  // 研发任务操作权限
  { code: 'rd-task:create', label: '新建任务', description: '通过 AI 解析或手动创建任务', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 80 },
  { code: 'rd-task:edit', label: '编辑任务', description: '修改任务字段和状态', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 81 },
  { code: 'rd-task:archive', label: '封存/解封任务', description: '触发任务封存或解除封存（需审批）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 82 },
  { code: 'rd-task:reassign', label: '转派任务', description: '批量或单条任务重分配（高级权限）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 83 },
  { code: 'rd-task:override-priority', label: '覆盖优先级', description: '覆盖 AI 判定的优先级（组长及以上）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 84 },
  { code: 'rd-people:manage', label: '管理研发人员', description: '新增、编辑、删除研发成员和任务容量', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 85 },
  { code: 'rd-approval-flow:manage', label: '管理审批流', description: '新增、调整、保存、重置研发审批流节点', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 86 },
  { code: 'rd-audit:clear', label: '清空操作留痕', description: '清空研发任务管理操作留痕记录', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 87 },
  { code: 'rd-ai:configure', label: '配置研发 AI 策略', description: '维护研发模块各 AI 场景模型、OCR 兜底、文件解析和人工确认策略', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 88 },

  // 立项流程操作权限
  { code: 'rd-project:propose', label: '立项申请', description: '提交立项需求，进入审核队列', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 90 },
  { code: 'rd-project:review-l1', label: '立项一审', description: '研发管理员审核立项（多级中的第一级）', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 91 },
  { code: 'rd-project:review-l2', label: '立项终审', description: '厂长 / 总监终审通过立项', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 92 },
  { code: 'rd-project:direct', label: '直接立项', description: '跳过审核，直接生效并自动分配（厂长 / 管理员）', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 93 },

  { code: 'page:after-sales', label: '售后 Case 管理', groupLabel: '页面访问 · 信息流转', type: 'page', routePath: '/after-sales', sortOrder: 100 },
  { code: 'page:rd-triage', label: '研发问题分流', groupLabel: '页面访问 · 信息流转', type: 'page', routePath: '/rd-triage', sortOrder: 110 },
  { code: 'page:registration-projects', label: '注册项目里程碑', groupLabel: '页面访问 · 信息流转', type: 'page', routePath: '/registration-projects', sortOrder: 120 },
  { code: 'page:bom-archive', label: 'BOM 确认存档', groupLabel: '页面访问 · 信息流转', type: 'page', routePath: '/bom-archive', sortOrder: 130 },
  { code: 'page:design-changes', label: '设计开发变更', groupLabel: '页面访问 · 信息流转', type: 'page', routePath: '/design-changes', sortOrder: 140 },

  { code: 'page:customs-ai', label: '报关单证 AI', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/customs-ai', sortOrder: 200 },
  { code: 'page:customs-docs', label: '报关单证处理', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/customs-docs', sortOrder: 210 },
  { code: 'page:external-docs', label: '对外资料版本', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/external-docs', sortOrder: 220 },
  { code: 'page:ra-knowledge', label: '法规知识库', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/ra-knowledge', sortOrder: 230 },
  { code: 'page:quality-dms', label: '质量文件 DMS', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/quality-dms', sortOrder: 240 },
  { code: 'page:qa-traceability', label: '全链路追溯', groupLabel: '页面访问 · 文件与知识', type: 'page', routePath: '/qa-traceability', sortOrder: 250 },

  { code: 'page:ui-design', label: 'UI 设计生成', groupLabel: '页面访问 · AI 创作', type: 'page', routePath: '/ui-design', sortOrder: 300 },

  { code: 'page:inquiry', label: '多渠道询盘', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/inquiry', sortOrder: 400 },
  { code: 'page:meeting', label: '会议纪要', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/meeting', sortOrder: 410 },
  { code: 'page:email-ai', label: '邮件 AI 写作', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/email-ai', sortOrder: 420 },
  { code: 'page:report-compression', label: '汇报材料压缩', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/report-compression', sortOrder: 430 },

  { code: 'page:resume-screening', label: '简历筛选', groupLabel: '页面访问 · 人事行政', type: 'page', routePath: '/resume-screening', sortOrder: 500 },
  { code: 'page:employee-archive', label: '员工入职归档', groupLabel: '页面访问 · 人事行政', type: 'page', routePath: '/employee-archive', sortOrder: 510 },
  { code: 'page:quick-capture', label: '随手记任务分流', groupLabel: '页面访问 · 人事行政', type: 'page', routePath: '/quick-capture', sortOrder: 520 },
  { code: 'page:expense-center', label: '费用报销统计', groupLabel: '页面访问 · 人事行政', type: 'page', routePath: '/expense-center', sortOrder: 530 },

  { code: 'page:ebpr', label: '电子批记录', groupLabel: '页面访问 · 质量与生产', type: 'page', routePath: '/ebpr', sortOrder: 600 },
  { code: 'page:inspection-release', label: '检验与放行', groupLabel: '页面访问 · 质量与生产', type: 'page', routePath: '/inspection-release', sortOrder: 610 },
  { code: 'page:bug-log', label: 'BUG 日志分析', groupLabel: '页面访问 · 质量与生产', type: 'page', routePath: '/bug-log', sortOrder: 620 },

  { code: 'page:contract-review', label: '合同 AI 审查', groupLabel: '页面访问 · 法务管理', type: 'page', routePath: '/contract-review', sortOrder: 700 },

  { code: 'page:ops-center', label: '运维总览', description: '查看运维总览、核心指标、错误趋势与二期接入状态', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center', sortOrder: 800 },
  { code: 'page:ops-api-errors', label: '接口与错误', description: '查看接口日志、请求详情、错误聚合与处理建议', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/api-errors', sortOrder: 810 },
  { code: 'page:ops-database', label: '数据库监控', description: '查看数据库连接、慢查询、锁等待、容量与 RDS/ECS 状态', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/database', sortOrder: 820 },
  { code: 'page:ops-services-tasks', label: '服务与任务', description: '查看第三方服务、阿里云集成与业务任务日志', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/services-tasks', sortOrder: 830 },
  { code: 'page:ops-alerts-audit', label: '告警与审计设置', description: '查看告警规则、日志策略、脱敏设置与操作审计', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/alerts-audit', sortOrder: 840 },

  { code: 'page:mailbox-management', label: '邮箱管理', description: '邮箱集成管理页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/mailbox-management', sortOrder: 900 },
  { code: 'page:ai-model-management', label: 'AI 模型管理', description: 'AI 模型配置页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/ai-model-management', sortOrder: 910 },
  { code: 'page:downloads', label: '下载和教程', description: '查看下载与教程页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/downloads', sortOrder: 920 },
  { code: 'page:departments', label: '部门管理', description: '查看部门主数据页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/departments', sortOrder: 930 },
  { code: 'page:users', label: '用户管理', description: '查看用户列表页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/users', sortOrder: 940 },
  { code: 'page:roles', label: '角色权限', description: '查看角色权限页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/roles', sortOrder: 950 },
  { code: 'page:route-management', label: '页面路由管理', description: '维护页面与按钮权限目录', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/route-management', sortOrder: 960 },
  { code: 'page:settings', label: '字典配置', description: '查看系统字典页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/settings', sortOrder: 970 },

  { code: 'department:create', label: '新建部门', description: '创建公司部门主数据', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1000 },
  { code: 'department:edit', label: '编辑部门', description: '修改部门信息与启停状态', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1010 },
  { code: 'department:delete', label: '删除部门', description: '删除未被用户使用的部门', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1020 },
  { code: 'user:create', label: '新建用户', description: '创建新用户账号', groupLabel: '操作权限 · 用户管理', type: 'action', sortOrder: 1100 },
  { code: 'user:edit', label: '编辑用户', description: '修改用户基本信息', groupLabel: '操作权限 · 用户管理', type: 'action', sortOrder: 1110 },
  { code: 'user:disable', label: '启用/停用用户', description: '切换用户账号状态', groupLabel: '操作权限 · 用户管理', type: 'action', sortOrder: 1120 },
  { code: 'user:delete', label: '删除用户', description: '永久删除用户账号', groupLabel: '操作权限 · 用户管理', type: 'action', sortOrder: 1130 },
  { code: 'user:reset-password', label: '重置密码', description: '管理员重置用户密码', groupLabel: '操作权限 · 用户管理', type: 'action', sortOrder: 1140 },
  { code: 'role:create', label: '新建角色', description: '创建新角色', groupLabel: '操作权限 · 角色管理', type: 'action', sortOrder: 1200 },
  { code: 'role:edit', label: '编辑角色', description: '修改角色权限配置', groupLabel: '操作权限 · 角色管理', type: 'action', sortOrder: 1210 },
  { code: 'role:delete', label: '删除角色', description: '永久删除角色', groupLabel: '操作权限 · 角色管理', type: 'action', sortOrder: 1220 },
  { code: 'resume:upload', label: '上传简历', groupLabel: '操作权限 · 简历筛选', type: 'action', sortOrder: 1300 },
  { code: 'resume:screen', label: '执行 AI 筛选', groupLabel: '操作权限 · 简历筛选', type: 'action', sortOrder: 1310 },
  { code: 'after-sales:create', label: '新建工单', groupLabel: '操作权限 · 售后工单', type: 'action', sortOrder: 1400 },
  { code: 'after-sales:edit', label: '编辑工单', groupLabel: '操作权限 · 售后工单', type: 'action', sortOrder: 1410 },
  { code: 'after-sales:delete', label: '删除工单', groupLabel: '操作权限 · 售后工单', type: 'action', sortOrder: 1420 },
  { code: 'after-sales:approve', label: '审批工单', groupLabel: '操作权限 · 售后工单', type: 'action', sortOrder: 1430 },
];
