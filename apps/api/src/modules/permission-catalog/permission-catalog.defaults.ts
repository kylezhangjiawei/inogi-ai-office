export type DefaultPermissionCatalogItem = {
  code: string;
  label: string;
  description?: string;
  groupLabel: string;
  type: 'page' | 'action';
  routePath?: string;
  /** When true the page is accessible but hidden from the sidebar navigation. Defaults to false. */
  navHidden?: boolean;
  sortOrder: number;
};

export const DEFAULT_PERMISSION_CATALOG: DefaultPermissionCatalogItem[] = [
  { code: 'page:dashboard', label: '系统首页', description: '查看系统首页', groupLabel: '页面访问 · 总览', type: 'page', routePath: '/', sortOrder: 10 },

  // ─── 研发任务管理 ───────────────────────────────────────────────────────────
  { code: 'page:rd-task-management', label: '研发任务驾驶舱', description: '树状任务表 · AI 解析新建 · 任务封存/移交', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-task-management', sortOrder: 3000 },
  { code: 'page:rd-my-workspace', label: '研发工作台', description: '我的任务、协作任务、今日待办、待审核 AI 建议', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-my-workspace', sortOrder: 3010 },
  { code: 'page:rd-knowledge-base', label: '研发知识库', description: '研发团队内部知识沉淀与权限分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/rd-knowledge-base', sortOrder: 5565 },
  { code: 'page:rd-sheet', label: '研发数据表', description: '类 WPS 表格，按密级行级管控的研发敏感数据；不同权限的人看到的行数不同', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-sheet', sortOrder: 3020 },
  // 保留历史权限码，生产驾驶舱迁移后既有角色授权和接口鉴权继续有效。
  { code: 'page:rd-director-dashboard', label: '生产驾驶舱', description: '与研发任务驾驶舱同版界面，使用独立生产任务池并只读展示研发同步任务', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/production-dashboard', sortOrder: 12000 },
  // 「研发人员管理」页（/rd-people-management）实际由动作码 rd-people:manage 守卫（见 App.tsx），
  // 这里的 page: 码从未被任何守卫或导航引用，属冗余登记，已移除。授权仍走 rd-people:manage。
  { code: 'page:rd-approval-flow', label: '审批流配置', description: '配置立项/任务审批的节点、模式、SLA', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-approval-flow', sortOrder: 3060 },
  { code: 'page:rd-ai-settings', label: '研发 AI 策略', description: '配置研发模块 AI 场景模型、文件解析顺序、OCR 兜底与披露策略', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-ai-settings', sortOrder: 3070 },

  // 研发任务操作权限
  { code: 'rd-task:create', label: '新建任务', description: '通过 AI 解析或手动创建任务', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 80 },
  { code: 'rd-task:edit', label: '编辑任务', description: '修改任务字段和状态', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 81 },
  { code: 'rd-task:archive', label: '封存/解封任务', description: '触发任务封存或解除封存（需审批）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 82 },
  { code: 'rd-task:reassign', label: '转派任务', description: '批量或单条任务重分配（高级权限）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 83 },
  { code: 'rd-task:view-all', label: '只读查看全部留痕', description: '跨部门只读查看研发驾驶舱的全部进度留痕与附件（不含编辑/转派等管理权限）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 83.5 },
  { code: 'rd-task:review-notify', label: '接收审核通知', description: '成果/协作/截止日期/放弃类审核提交时收到站内通知。与「能否审批」解耦：兼任研发权限但不负责审核的岗位，取消此项即可不再收到通知', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 83.8 },
  { code: 'rd-task:move', label: '移动任务归类', description: '将任务移动到其他系统、子项或产品（含跨产品移动）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 84 },
  { code: 'rd-task:sync-production', label: '同步任务到生产驾驶舱', description: '将研发任务同步或撤销同步到生产驾驶舱；生产侧镜像始终只读', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 84.5 },
  { code: 'rd-task:override-priority', label: '覆盖优先级', description: '覆盖 AI 判定的优先级（组长及以上）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 85 },
  { code: 'rd-people:manage', label: '管理研发人员', description: '新增、编辑、删除研发成员和任务容量', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 86 },
  { code: 'rd-approval-flow:manage', label: '管理审批流', description: '新增、调整、保存、重置研发审批流节点', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 87 },
  { code: 'rd-ai:configure', label: '配置研发 AI 策略', description: '维护研发模块各 AI 场景模型、OCR 兜底、文件解析和人工确认策略', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 89 },
  { code: 'rd-data:clear', label: '清空研发任务数据', description: '清空研发任务分类、个人工作台和生产驾驶舱数据', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 90 },
  { code: 'rd-sheet:edit', label: '编辑研发数据表', description: '新增/修改/删除数据表的行列与密级；拥有此权限即可看到全量数据（不受行级密级裁剪）', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 91 },

  // 研发知识库操作权限（细粒度，与页面权限 page:rd-knowledge-base 配合使用）
  { code: 'rd-kb:upload', label: '上传知识库文件', description: '向知识库上传文件（含拖拽 / 文件选择）', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 95 },
  { code: 'rd-kb:entry:edit', label: '编辑知识库文件', description: '修改已上传文件的名称、描述、标签、权限分值', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 96 },
  { code: 'rd-kb:entry:move', label: '移动知识库文件', description: '把文件在分类之间移动归位', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 97 },
  { code: 'rd-kb:entry:delete', label: '删除知识库文件', description: '删除已上传的文件', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 98 },
  { code: 'rd-kb:category:create', label: '新增知识库分类', description: '新建一级或子级分类', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 99 },
  { code: 'rd-kb:category:edit', label: '编辑知识库分类', description: '修改分类名称 / 图标 / 颜色', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 100 },
  { code: 'rd-kb:category:delete', label: '删除知识库分类', description: '删除空分类（含子分类）', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 101 },
  { code: 'rd-kb:manage', label: '管理知识库（兼容旧权限）', description: '旧的笼统管理权限，建议改用上面细分的权限；后端仍兼容此权限以避免历史角色失效', groupLabel: '操作权限 · 研发知识库', type: 'action', sortOrder: 102 },

  // ─── 部门知识库（8 个部门各一个独立库；逻辑同研发知识库，按部门页面码隔离）─────────────
  // 页面访问：每部门一个页面码，决定该用户「属于哪个部门库」（后端 DeptKbGuard 按 kbId 动态校验）
  { code: 'page:dept-kb-gm', label: '总经办知识库', description: '总经办部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/gm', sortOrder: 6160 },
  { code: 'page:dept-kb-hr', label: '人事行政部知识库', description: '人事行政部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/hr', sortOrder: 6161 },
  { code: 'page:dept-kb-finance', label: '财务部知识库', description: '财务部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/finance', sortOrder: 6162 },
  { code: 'page:dept-kb-purchasing', label: '采购部知识库', description: '采购部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/purchasing', sortOrder: 6163 },
  { code: 'page:dept-kb-production', label: '生产部知识库', description: '生产部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/production', sortOrder: 6164 },
  // 技术研发部不单设部门库：研发团队统一用「研发知识库」(page:rd-knowledge-base)，故此处不再有 page:dept-kb-tech-rd。
  { code: 'page:dept-kb-quality', label: '质量部知识库', description: '质量部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/quality', sortOrder: 6166 },
  { code: 'page:dept-kb-sales', label: '销售部知识库', description: '销售部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/sales', sortOrder: 6167 },
  // 补齐「每个部门一个知识库」。标签会在读取时按部门主数据当前名同步覆盖（syncDepartmentKnowledgeLabels），
  // 这里的字面值只是首次落库前的占位。
  { code: 'page:dept-kb-after-sales', label: '售后服务部知识库', description: '售后服务部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/after-sales', sortOrder: 6180 },
  { code: 'page:dept-kb-rd-registration', label: '研发注册部知识库', description: '研发注册部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/rd-registration', sortOrder: 6181 },
  { code: 'page:dept-kb-customs', label: '关务单证部知识库', description: '关务单证部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/customs', sortOrder: 6182 },
  { code: 'page:dept-kb-legal', label: '法务合同部知识库', description: '法务合同部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/legal', sortOrder: 6183 },
  { code: 'page:dept-kb-it', label: '信息系统部知识库', description: '信息系统部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/it', sortOrder: 6184 },
  { code: 'page:dept-kb-rd-production', label: '研发生产部知识库', description: '研发生产部门知识沉淀与分级查阅', groupLabel: '页面访问 · 知识库', type: 'page', routePath: '/dept-kb/rd-production', sortOrder: 6185 },

  // ─── 中美协同（美国团队使用，中国研发团队支持；驾驶舱/工作台复用研发页面，知识库为独立 dept KB 库 us-collab）────
  { code: 'page:us-collab-cockpit', label: '协同任务驾驶舱', description: '中美协同任务驾驶舱（复用研发驾驶舱能力，不含子系统全景）', groupLabel: '页面访问 · 中美协同', type: 'page', routePath: '/us-collab-cockpit', sortOrder: 4000 },
  { code: 'page:us-collab-workspace', label: '协同工作台', description: '中美协同个人工作台（复用研发个人工作台能力）', groupLabel: '页面访问 · 中美协同', type: 'page', routePath: '/us-collab-workspace', sortOrder: 4010 },
  { code: 'page:dept-kb-us-collab', label: '协同知识库', description: '中美协同独立知识库（与部门知识库同机制，存储隔离）', groupLabel: '页面访问 · 中美协同', type: 'page', routePath: '/us-collab-kb', sortOrder: 4020 },
  { code: 'page:us-collab-approval-flow', label: '协同审批流配置', description: '中美协同审批流配置（复用研发审批流页面，流程数据与研发池隔离）', groupLabel: '页面访问 · 中美协同', type: 'page', routePath: '/us-collab-approval-flow', sortOrder: 4030 },
  { code: 'page:us-collab-ai-settings', label: '协同 AI 策略', description: '中美协同 AI 策略配置（复用研发 AI 策略页面，配置与研发池隔离）', groupLabel: '页面访问 · 中美协同', type: 'page', routePath: '/us-collab-ai-settings', sortOrder: 4040 },
  // 操作权限：8 个部门库共用同一套操作码（归属由页面码决定）
  { code: 'dept-kb:upload', label: '上传部门知识库文件', description: '向所属部门知识库上传文件（含拖拽 / 文件选择）', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 670 },
  { code: 'dept-kb:entry:edit', label: '编辑部门知识库文件', description: '修改已上传文件的名称、描述、标签、权限分值', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 671 },
  { code: 'dept-kb:entry:move', label: '移动部门知识库文件', description: '把文件在分类之间移动归位', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 672 },
  { code: 'dept-kb:entry:delete', label: '删除部门知识库文件', description: '删除已上传的文件', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 673 },
  { code: 'dept-kb:category:create', label: '新增部门知识库分类', description: '新建一级或子级分类', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 674 },
  { code: 'dept-kb:category:edit', label: '编辑部门知识库分类', description: '修改分类名称 / 图标 / 颜色', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 675 },
  { code: 'dept-kb:category:delete', label: '删除部门知识库分类', description: '删除空分类（含子分类）', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 676 },
  { code: 'dept-kb:manage', label: '管理部门知识库', description: '可设置文件权限分值，隐含全部上传/编辑/分类操作', groupLabel: '操作权限 · 知识库', type: 'action', sortOrder: 677 },

  // 立项流程操作权限
  { code: 'rd-project:propose', label: '立项申请', description: '提交立项需求，进入审核队列', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 90 },
  { code: 'rd-project:review-l1', label: '立项一审', description: '研发管理员审核立项（多级中的第一级）', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 91 },
  { code: 'rd-project:review-l2', label: '立项终审', description: '研发主管 / 总监终审通过立项', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 92 },
  { code: 'rd-project:direct', label: '直接立项', description: '跳过审核，直接生效并自动分配（研发主管 / 管理员）', groupLabel: '操作权限 · 立项流程', type: 'action', sortOrder: 93 },

  { code: 'page:after-sales', label: '售后 Case 管理', groupLabel: '页面访问 · 客户服务', type: 'page', routePath: '/after-sales', sortOrder: 6010 },
  { code: 'page:rd-triage', label: '研发问题分流', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/rd-triage', sortOrder: 3040 },
  { code: 'page:registration-projects', label: '注册项目里程碑', groupLabel: '页面访问 · 注册与关务', type: 'page', routePath: '/registration-projects', sortOrder: 7000 },
  { code: 'page:bom-archive', label: 'BOM 确认存档', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/bom-archive', sortOrder: 2070 },
  { code: 'page:design-changes', label: '设计开发变更', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/design-changes', sortOrder: 3050 },

  { code: 'page:customs-ai', label: '报关单证 AI', groupLabel: '页面访问 · 注册与关务', type: 'page', routePath: '/customs-ai', sortOrder: 7030 },
  { code: 'page:customs-docs', label: '报关单证处理', groupLabel: '页面访问 · 注册与关务', type: 'page', routePath: '/customs-docs', sortOrder: 7040 },
  { code: 'page:external-docs', label: '对外资料版本', groupLabel: '页面访问 · 注册与关务', type: 'page', routePath: '/external-docs', sortOrder: 7020 },
  { code: 'page:ra-knowledge', label: '法规知识库', groupLabel: '页面访问 · 注册与关务', type: 'page', routePath: '/ra-knowledge', sortOrder: 7010 },
  { code: 'page:quality-dms', label: '质量文件 DMS', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/quality-dms', sortOrder: 12060 },
  { code: 'page:qa-traceability', label: '全链路追溯', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/qa-traceability', sortOrder: 12070 },

  { code: 'page:warehouse-cockpit', label: '仓库驾驶舱', description: '汇总当前业务权限范围内的库存预警、待收货与领料待办', groupLabel: '页面访问 · 订单与仓储', type: 'page', routePath: '/warehouse-cockpit', sortOrder: 8759 },
  { code: 'page:order-workbench', label: '订货单处理工作台', description: '订货单队列、商品校验、商业发票生成与模板管理', groupLabel: '页面访问 · 订单与仓储', type: 'page', routePath: '/order-workbench', sortOrder: 8000 },
  { code: 'order-processing:material-map', label: '订单物料核对', description: '核对订单商品与正式物料的关联；同时需要订单工作台页面权限，不授予库存写入权限', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 261 },
  { code: 'page:purchase-orders', label: '采购订单', description: '采购订单导入、过滤查询与到货跟踪', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/purchase-orders', sortOrder: 2060 },
  { code: 'page:purchase-order-detail', label: '采购订单详情', description: '查看采购订单明细、供应商、履约、结算与备注信息', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/purchase-orders/:id', navHidden: true, sortOrder: 2766 },
  { code: 'page:inventory-management', label: '库存管理', description: '库存台账、入库登记、预警商品与出入库记录', groupLabel: '页面访问 · 订单与仓储', type: 'page', routePath: '/inventory-management', sortOrder: 8020 },

  // 供应链管理（采购任务、备货、物料与供应商报价）
  { code: 'page:proc-cockpit', label: '供应链任务驾驶舱', description: '采购任务全流程视角：询价/打样/测试/下单/到货', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-cockpit', sortOrder: 2000 },
  { code: 'page:proc-my-workspace', label: '采购工作台', description: '成员视角：只看分配给我的采购任务，按阶段分组推进', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-my-workspace', sortOrder: 2010 },
  { code: 'page:proc-materials', label: '供应链物料库', description: '物料主数据与库存/在途资产视角：分类、审核与历史价格', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-materials', sortOrder: 2020 },
  { code: 'page:proc-key-materials', label: '关键物料全量目录', description: '查看会议关键物料与正式料号、库存映射；修改另需物料审核权限', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-key-materials', sortOrder: 2030 },
  { code: 'page:proc-inventory-readiness', label: '库存齐套中心', description: '按产品 BOM 汇总量产仓库的库存与在途，计算物料可齐套套数和瓶颈缺口', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-inventory-readiness', sortOrder: 2040 },
  { code: 'page:proc-quote-book', label: '供应商报价库', description: '同一商品跨厂家比价：树形维护厂家报价与起订量阶梯价', groupLabel: '页面访问 · 供应链管理', type: 'page', routePath: '/proc-quote-book', sortOrder: 2050 },

  { code: 'page:ui-design', label: 'AI 图像生成', groupLabel: '页面访问 · AI 创作', type: 'page', routePath: '/ui-design', sortOrder: 9000 },
  { code: 'page:image-library', label: '图像作品库', description: '历史创作、收藏作品与上游用量统计', groupLabel: '页面访问 · AI 创作', type: 'page', routePath: '/image-library', sortOrder: 9010 },
  { code: 'page:video-library', label: '视频作品库', description: '对话式生成的视频任务、状态与成本闸门配置', groupLabel: '页面访问 · AI 创作', type: 'page', routePath: '/video-library', sortOrder: 9020 },

  // 图像作品库分类：目录全局共享，「查」跟随 page:image-library，写操作按下面三个码细分
  { code: 'image-category:create', label: '新增图像分类', description: '在图像作品库中新建分类', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 307 },
  { code: 'image-category:edit', label: '编辑图像分类', description: '修改图像分类的名称、说明、颜色与排序', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 308 },
  { code: 'image-category:delete', label: '删除图像分类', description: '删除图像分类，分类下的作品保留并转为未分类', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 309 },

  // 视频作品库分类：与图像分类同构，「查」跟随 page:video-library
  { code: 'video-category:create', label: '新增视频分类', description: '在视频作品库中新建分类', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 310 },
  { code: 'video-category:edit', label: '编辑视频分类', description: '修改视频分类的名称、说明、颜色与排序', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 311 },
  { code: 'video-category:delete', label: '删除视频分类', description: '删除视频分类，分类下的视频保留并转为未分类', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 312 },

  // 上传本地素材进作品库：与生成作品同库同分类，权限单独收口
  { code: 'image-library:upload', label: '上传图片到作品库', description: '把本地图片上传进图像作品库', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 313 },
  { code: 'video-library:upload', label: '上传视频到作品库', description: '把本地视频上传进视频作品库', groupLabel: '操作权限 · AI 创作', type: 'action', sortOrder: 314 },

  { code: 'page:inquiry', label: '多渠道询盘', groupLabel: '页面访问 · 客户服务', type: 'page', routePath: '/inquiry', sortOrder: 6000 },
  { code: 'page:meeting', label: '会议纪要', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/meeting', sortOrder: 10000 },
  { code: 'page:email-ai', label: '邮件 AI 写作', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/email-ai', sortOrder: 10010 },
  { code: 'page:report-compression', label: '汇报材料压缩', groupLabel: '页面访问 · 沟通协同', type: 'page', routePath: '/report-compression', sortOrder: 10020 },

  { code: 'page:resume-screening', label: '简历筛选', groupLabel: '页面访问 · 人事与行政', type: 'page', routePath: '/resume-screening', sortOrder: 11000 },
  { code: 'page:applicant-forms', label: '应聘登记', groupLabel: '页面访问 · 人事与行政', type: 'page', routePath: '/applicant-forms', sortOrder: 11010 },
  { code: 'applicant-form:edit', label: '配置应聘登记表', description: '创建模板、编辑草稿及使用 AI 调整字段', groupLabel: '操作权限 · 人事与行政', type: 'action', sortOrder: 502 },
  { code: 'applicant-form:publish', label: '发布应聘登记表', description: '确认发布草稿为生效版本，更新对外填写链接', groupLabel: '操作权限 · 人事与行政', type: 'action', sortOrder: 503 },
  { code: 'applicant-form:records', label: '查看与处理应聘登记', description: '按版本查询登记、查看资料和附件、维护处理状态与内部备注', groupLabel: '操作权限 · 人事与行政', type: 'action', sortOrder: 504 },
  { code: 'page:employee-archive', label: '员工入职归档', groupLabel: '页面访问 · 人事与行政', type: 'page', routePath: '/employee-archive', sortOrder: 11020 },
  { code: 'page:quick-capture', label: '人员考勤', description: '每日打卡、考勤异常、补录修正与考勤导出', groupLabel: '页面访问 · 人事与行政', type: 'page', routePath: '/attendance', sortOrder: 11030 },
  { code: 'attendance:import', label: '考勤数据导入', description: '导入企业微信打卡日报，会批量覆盖当期考勤记录', groupLabel: '操作权限 · 人事与行政', type: 'action', sortOrder: 521 },
  { code: 'page:expense-center', label: '费用报销统计', groupLabel: '页面访问 · 人事与行政', type: 'page', routePath: '/expense-center', sortOrder: 11040 },

  { code: 'page:ebpr', label: '电子批记录', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/ebpr', sortOrder: 12020 },
  { code: 'page:inspection-release', label: '检验与放行', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/inspection-release', sortOrder: 12050 },
  { code: 'page:bug-log', label: 'BUG 日志分析', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/bug-log', sortOrder: 12080 },

  { code: 'page:contract-review', label: '合同 AI 审查', groupLabel: '页面访问 · 法务管理', type: 'page', routePath: '/contract-review', sortOrder: 13000 },

  { code: 'page:ops-center', label: '运维总览', description: '查看运维总览、核心指标、错误趋势与二期接入状态', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center', sortOrder: 14000 },
  { code: 'page:ops-api-errors', label: '接口与错误', description: '查看接口日志、请求详情、错误聚合与处理建议', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/api-errors', sortOrder: 14010 },
  { code: 'page:ops-database', label: '数据库监控', description: '查看数据库连接、慢查询、锁等待、容量与 RDS/ECS 状态', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/database', sortOrder: 14020 },
  { code: 'page:ops-services-tasks', label: '服务与任务', description: '查看第三方服务、阿里云集成与业务任务日志', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/services-tasks', sortOrder: 14030 },
  { code: 'page:ops-alerts-audit', label: '告警与审计设置', description: '查看告警规则、日志策略、脱敏设置与操作审计', groupLabel: '页面访问 · 系统运维中心', type: 'page', routePath: '/ops-center/alerts-audit', sortOrder: 14040 },

  // 「个人中心」/「消息中心」曾在此登记为隐藏页面，但两者的路由是 lazyWrap（任意登录用户可访问、
  // 无权限门），页面码从未被任何守卫或导航使用，留在目录里只会让角色编辑器多出勾了也没用的选项。
  // 已移除；若要重新做成受控页面，需同时给 App.tsx 的路由加回 makeLazyProtected。

  // 全站统一操作留痕。研发 / 中美协同 / 采购三个留痕页合并到 /audit-log，页面码收敛为这一个；
  // 能看自己还是看全部由服务端按管理权限分层判定，不再靠多发几个页面码来区分。
  { code: 'page:audit-log', label: '操作留痕', description: '全站操作留痕：按模块、操作人、动作、时间筛选所有人的写操作记录（含超级管理员）', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/audit-log', sortOrder: 15100 },

  { code: 'page:mailbox-management', label: '邮箱管理', description: '邮箱集成管理页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/mailbox-management', sortOrder: 15000 },
  { code: 'page:ai-model-management', label: 'AI 模型管理', description: 'AI 模型配置页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/ai-model-management', sortOrder: 15010 },
  { code: 'page:ai-usage-dashboard', label: 'AI 使用情况', description: '按模型 / 人员的用量与成本统计看板', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/ai-usage', sortOrder: 15020 },
  { code: 'page:content-slots', label: '运营素材管理', description: 'MateChat 每日吉祥物图 / 激励文案等动态素材位的统一管理', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/content-slots', sortOrder: 15030 },
  { code: 'page:chat-analytics', label: 'AI 使用与反馈', description: '查看 MateChat 使用、质量、反馈与问题明细', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/chat-analytics', sortOrder: 15040 },
  { code: 'chat-feedback:manage', label: '处理 AI 反馈', description: '更新 MateChat 问题反馈的处理状态与处理结论', groupLabel: '操作权限 · AI 使用与反馈', type: 'action', sortOrder: 913 },
  { code: 'page:ocr-config-management', label: '腾讯OCR配置', description: '腾讯 OCR 凭证配置页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/ocr-config-management', sortOrder: 15060 },
  { code: 'page:downloads', label: '下载和教程', description: '查看下载与教程页面', groupLabel: '页面访问 · 帮助与教程', type: 'page', routePath: '/downloads', sortOrder: 16010 },
  { code: 'page:manual', label: '操作手册', description: '按页面查看图文操作手册（当前含中美协同三页）', groupLabel: '页面访问 · 帮助与教程', type: 'page', routePath: '/manual', sortOrder: 16000 },
  { code: 'page:departments', label: '部门管理', description: '查看部门主数据页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/departments', sortOrder: 15070 },
  { code: 'page:users', label: '用户管理', description: '查看用户列表页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/users', sortOrder: 15080 },
  { code: 'page:roles', label: '角色权限', description: '查看角色权限页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/roles', sortOrder: 15090 },
  { code: 'page:route-management', label: '页面路由管理', description: '维护页面与按钮权限目录', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/route-management', sortOrder: 15110 },
  { code: 'page:settings', label: '字典配置', description: '查看系统字典页面', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/settings', sortOrder: 15120 },
  { code: 'page:electronic-gate', label: '电子闸门', description: '独立维护出厂质检规则、人工确认、设备连接与返工指令配置，保存草稿并单项发布', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/electronic-gate', sortOrder: 12030 },
  { code: 'page:device-inspection-records', label: '设备检测记录', description: '查询Windows上传的不可变检测快照、异常证据及同设备历次检测', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/device-inspection-records', sortOrder: 12040 },
  // ⚠️ 码名沿用 i18n:manage（而非 page: 前缀）：它已被 4 个后端接口的 @Permissions 和既有角色数据引用，
  // 改名会同时打断鉴权与存量授权。类型登记为 page —— 它守卫的就是 /i18n-management 这一整个页面。
  { code: 'i18n:manage', label: '翻译管理', description: '维护英文词条字典、导入导出翻译', groupLabel: '页面访问 · 系统管理', type: 'page', routePath: '/i18n-management', sortOrder: 15050 },

  { code: 'department:create', label: '新建部门', description: '创建公司部门主数据', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1000 },
  { code: 'department:edit', label: '编辑部门', description: '修改部门信息与启停状态', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1010 },
  { code: 'department:delete', label: '删除部门', description: '删除未被用户使用的部门', groupLabel: '操作权限 · 部门管理', type: 'action', sortOrder: 1020 },
  { code: 'expense:view-all', label: '查看全部部门费用', description: '跨部门查看与筛选费用报销数据并批量改派部门（默认仅本部门）', groupLabel: '操作权限 · 费用报销', type: 'action', sortOrder: 1030 },
  { code: 'expense:archive-manage', label: '管理费用归档', description: '新增、修改分类并移动或移出归档凭证', groupLabel: '操作权限 · 费用报销', type: 'action', sortOrder: 1031 },
  { code: 'expense:submit-on-behalf', label: '代他人提交报销', description: '允许修改申请人与企业微信提单人后代为提交报销', groupLabel: '操作权限 · 费用报销', type: 'action', sortOrder: 1032 },
  { code: 'expense:manage-integrations', label: '管理费用集成配置', description: '读取和修改费用模块的企业微信、OCR 等敏感集成配置', groupLabel: '操作权限 · 费用报销', type: 'action', sortOrder: 1033 },
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
  { code: 'resume:delete', label: '删除候选人', description: '删除已导入的候选人记录及其筛选数据', groupLabel: '操作权限 · 简历筛选', type: 'action', sortOrder: 1320 },
  { code: 'after-sales:create', label: '新建工单', groupLabel: '操作权限 · 客户服务', type: 'action', sortOrder: 1400 },
  { code: 'after-sales:edit', label: '编辑工单', groupLabel: '操作权限 · 客户服务', type: 'action', sortOrder: 1410 },
  { code: 'after-sales:delete', label: '删除工单', groupLabel: '操作权限 · 客户服务', type: 'action', sortOrder: 1420 },
  { code: 'after-sales:approve', label: '审批工单', groupLabel: '操作权限 · 客户服务', type: 'action', sortOrder: 1430 },

  // ─── 问题记录与 AI 定位（issue-ai）───────────────────────────────────────────
  { code: 'page:issue-ai', label: '问题记录与 AI 定位', description: '问题登记、AI 6M 根因分析、方案采纳与复用、问题知识库', groupLabel: '页面访问 · 研发任务管理', type: 'page', routePath: '/issue-ai', sortOrder: 3030 },
  { code: 'issue:create', label: '登记问题', description: '新建问题记录并触发 AI 根因分析', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 1500 },
  { code: 'issue:resolve', label: '问题定性 / AI 配置', description: '判定问题是否已解决（进知识库可复用），并维护本模块 AI 配置', groupLabel: '操作权限 · 研发任务管理', type: 'action', sortOrder: 1510 },

  // 供应链管理 · 操作权限（下单/入库在畅捷通 T+ 内完成，本系统无采购审批码）
  { code: 'proc-task:create', label: '新建 / 编辑采购任务', description: '采购自建需求、维护任务信息与附件、维护物料主数据', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1600 },
  { code: 'proc-production:report', label: '登记生产报工', description: '新增及修改子系统实际产量、良品量、工时和产能记录', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1601 },
  { code: 'proc-quality:manage', label: '处理采购 / 生产不良', description: '登记不良数量、处置进度及处理结果；关闭须质量验证权限', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1602 },
  { code: 'proc-quality:verify', label: '质量复验与关闭', description: '登记独立复验依据与数量，验证通过后关闭；按原因重新打开质量异常', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1603 },
  { code: 'page:production-execution', label: '生产计划与执行', description: '查看月度生产目标、批次、派工及现场报工', groupLabel: '页面访问 · 生产与质量', type: 'page', routePath: '/production-execution', sortOrder: 12010 },
  { code: 'production:transfer', label: '发布转量产资料与 ECN', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1613 },
  { code: 'production:release', label: '独立验证与质量放行', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1614 },
  { code: 'production:ship', label: '登记实际发货与冲销', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1615 },
  { code: 'production:plan', label: '生产计划与派工', description: '确认月度目标、拆分批次、编制与派发作业；不自动获得质量验证权限', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1604 },
  { code: 'production:inspect', label: '登记生产初检', description: '对已报工的互不重叠批次登记初检；不良自动关联质量异常，复验及关闭另需质量验证权限', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1605 },
  { code: 'proc-quality:collaborate', label: '回复质量协同', description: '当前获指派的研发或其他部门处理人回复原异常，回复不等于验证通过', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1606 },
  { code: 'page:warehouse-flow', label: '仓库工作台', description: '集中办理配料、领料签收、入库与退料；盘点入口跳转独立页面', groupLabel: '页面访问 · 订单与仓储', type: 'page', routePath: '/warehouse-flow', sortOrder: 8010 },
  { code: 'page:warehouse-count', label: '库存盘点', description: '查看独立盘点单与结果；发起、实盘和复核分别授权', groupLabel: '页面访问 · 订单与仓储', type: 'page', routePath: '/warehouse-count', sortOrder: 8500 },
  { code: 'warehouse:count-initiate', label: '发起库存盘点', description: '确定盘点范围并建立账面快照；不自动获得实盘或复核权限', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1609 },
  { code: 'warehouse:receive', label: '确认收货与退料入库', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1610 },
  { code: 'warehouse:write-erp', label: '创建 ERP 采购入库单', description: '按检验合格数量创建采购入库单并回读状态，审核保留在 ERP 内完成', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1611 },
  { code: 'warehouse:count', label: '填写盘点实盘', description: '对已发起的盘点单填写实盘数量；不能发起盘点或复核自己的结果', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1611 },
  { code: 'warehouse:adjust', label: '复核库存调整', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1612 },
  { code: 'warehouse:issue', label: '登记生产发料', description: '按实物交接登记分批发料，不改写 T+ 库存；签收须由实际领料人确认', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1607 },
  { code: 'warehouse:reconcile', label: '核对 T+ 过账凭证', description: '逐项核对出库凭证、登记差异或撤回核对，保留人工核对依据；不改写 T+ 库存', groupLabel: '操作权限 · 订单与仓储', type: 'action', sortOrder: 1608 },
  { code: 'production:view-all', label: '查看全部生产执行', description: '只读查看各人员生产作业；未授权人员仅查看本人作业或获指派的异常协同', groupLabel: '操作权限 · 生产与质量', type: 'action', sortOrder: 1608 },
  { code: 'proc-task:transfer', label: '转采购', description: '研发侧将任务转为采购需求（需带附件）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1610 },
  { code: 'rd-procurement:review', label: '研发转采购审核', description: '研发管理员审核研发任务的转采购申请；通过后才流转并分配给采购人员', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1615 },
  { code: 'proc-task:confirm', label: '确认接收', description: '采购确认接收流转来的任务，进入询价 / 直购分支', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1620 },
  { code: 'proc-task:inquiry', label: '询价 / 推进状态', description: '从供应商报价库选择报价并推进任务状态（打样、测试、到货）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1630 },
  { code: 'proc-task:select-quote', label: '选定报价', description: '在多份报价中定标，回写物料最新价格', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1640 },
  { code: 'proc-task:order', label: '关联采购单', description: '把任务关联到畅捷通 T+ 的采购单据（本系统不创建单据）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1650 },
  { code: 'proc-purchase-order:write-erp', label: '维护ERP采购订单', description: '在采购订单页面新增、修改、删除ERP未审订单并核对结果；不会自动审核或弃审', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1652 },
  { code: 'proc-purchase-order:confirm-availability', label: '确认订单行可用日期', description: '人工确认采购订单行预计检验后可用日期及备注；不改变 ERP 到货量、库存或检验结论', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1651 },
  { code: 'proc-purchase-order:receive', label: '登记订单行收货', description: '按送货单逐笔记录订单行实收数量；不改变 ERP 累计执行数量或库存', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1652 },
  { code: 'proc-purchase-order:inspect', label: '登记来料检验', description: '记录收货批次的合格、不良、待判数量及检验依据；保留历次判定，不自动入库', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1653 },
  { code: 'proc-operations:assign', label: '分派仓管与质量任务', description: '按原订单行和收货批次分派、交接岗位任务，保留历史；同时需要订单详情和采购管理查看权限', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1654 },
  { code: 'proc-purchase-order:record-commitment', label: '登记供应商交期承诺', description: '记录供应商承诺、沟通凭据与改期原因，不回写 ERP', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1655 },
  { code: 'proc-purchase-order:adjust-fulfillment', label: '申请订单履约调整', description: '登记取消、退货、冲销及覆盖核对申请，保留原始收货和 ERP 数据', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1656 },
  { code: 'proc-purchase-order:approve-fulfillment', label: '审批订单履约调整', description: '批准或撤销本地订单履约调整，保留审批历史，不修改 ERP 库存', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1657 },
  { code: 'proc-task:receive', label: '登记到货', description: '手工登记到货数量（过渡期能力，畅捷通 T+ 接通后改由同步驱动）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1655 },
  { code: 'proc-task:rollback', label: '回退流程', description: '将任务退回到流程中更早的任意节点（会清理报价与采购单关联，需填写原因）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1658 },
  { code: 'proc-task:reassign', label: '转派采购负责人', description: '变更任务的采购负责人', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1660 },
  { code: 'proc-task:delete', label: '取消 / 删除任务', description: '取消进行中的采购任务或删除错误任务', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1670 },
  { code: 'material:review', label: '物料审核', description: '审核待确认物料（通过 / 驳回）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1680 },
  { code: 'material:import', label: '物料批量导入', description: '批量导入物料主数据', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1690 },
  { code: 'bom:publish', label: 'BOM 核对与发布', description: '确认设备产品归属、发布和停用 BOM 版本；同时需要对应页面权限', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1691 },
  { code: 'quote-book:manage', label: '维护供应商报价库', description: '供应商报价库的厂家报价增删改与批量导入（过渡期持「询价/推进状态」也可写）', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1695 },
  { code: 'proc:sync-erp', label: '同步畅捷通 T+', description: '手动触发供应商 / 库存 / 采购单的只读同步', groupLabel: '操作权限 · 供应链管理', type: 'action', sortOrder: 1700 },
];
