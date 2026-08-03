/**
 * 部门知识库（dept KB）共享常量。
 *
 * 这些库与「研发知识库」复用同一套服务层 CRUD 逻辑，仅按 kbId 切换存储键
 * （deptkb.{id}.* ）与 OSS 路径（deptkb/{id}/）。dept KB 的访问控制由
 * DeptKbGuard 按 kbId 动态校验「页面码 page:dept-kb-{id} + 共用操作码 dept-kb:*」。
 *
 * ⚠️ 这里的 id 是永久标识：存储键、权限码、路由全部依赖它，确定后不可更名，
 *    否则历史数据与已分配角色会全部失效。
 */

export type DeptKbDef = {
  id: string;
  /** 兜底显示名。库实际展示名以对应 Department 的当前名称为准（见 departmentCode）。 */
  label: string;
  /**
   * 对应部门的稳定编码（Department.code）。有此字段的库，其名称跟随部门改名自动同步：
   * 部门保存时会改写权限目录中 page:dept-kb-{id} 的标签，前端再据此展示。
   * 无此字段（如 us-collab）表示该库不对应任何部门主数据，固定用 label。
   */
  departmentCode?: string;
};

/**
 * 部门知识库清单（固定硬编码，不绑定 DB 的 Department 表）。
 * 技术研发部不单设部门库——研发团队统一用「研发知识库」(page:rd-knowledge-base / 全功能页)，
 * 故这里不含 tech-rd；其页面码 page:dept-kb-tech-rd 已从权限目录默认值移除。
 *
 * ⚠️ 本文件是「库 id ↔ 部门编码」的唯一事实源。departments.service / permission-catalog.service
 *    一律从这里派生，禁止再各自维护一份映射——此前三处副本已出现漂移（前端漏了 finance/purchasing）。
 */
export const DEPT_KBS: DeptKbDef[] = [
  { id: 'gm', label: '总经办', departmentCode: 'GENERAL_OFFICE' },
  { id: 'hr', label: '人事行政部', departmentCode: 'HR_ADMIN' },
  { id: 'finance', label: '财务部', departmentCode: 'FINANCE' },
  { id: 'purchasing', label: '采购部', departmentCode: 'PURCHASING' },
  { id: 'production', label: '生产部', departmentCode: 'PRODUCTION' },
  { id: 'quality', label: '质量部', departmentCode: 'REGULATORY_QUALITY' },
  { id: 'sales', label: '销售部', departmentCode: 'SALES_MARKETING' },
  // 以下 6 个补齐「每个部门都有独立知识库」：各部门资料需按人做可见范围控制，
  // 故均登记进 LEVEL_FILTERED_DEPT_KB_IDS（见下）。
  // ⚠️ rd-production 不能叫 production —— 那个 id 已被生产运营部占用。
  { id: 'after-sales', label: '售后服务部', departmentCode: 'AFTER_SALES' },
  { id: 'rd-registration', label: '研发注册部', departmentCode: 'RD_REGISTRATION' },
  { id: 'customs', label: '关务单证部', departmentCode: 'CUSTOMS_DOCUMENTS' },
  { id: 'legal', label: '法务合同部', departmentCode: 'LEGAL_CONTRACT' },
  { id: 'it', label: '信息系统部', departmentCode: 'IT_SYSTEM' },
  { id: 'rd-production', label: '研发生产部', departmentCode: 'PRODUCTION_DEPARTMENT' },
  // 中美协同知识库：给美国团队协同页面配套的独立库（前端入口在「中美协同」分组，不在部门知识库分组展示）
  { id: 'us-collab', label: '协同' },
];

/** 部门编码 → 知识库 id。由 DEPT_KBS 派生，不单独维护。 */
export const DEPARTMENT_KB_ID_BY_CODE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    DEPT_KBS.filter((kb) => kb.departmentCode).map((kb) => [kb.departmentCode as string, kb.id]),
  ),
);

export const DEPT_KB_IDS: ReadonlySet<string> = new Set(DEPT_KBS.map((d) => d.id));

/**
 * 启用「按人分值过滤」的部门库：库管理员（dept-kb:manage）在知识库页面维护成员分值表
 * （deptkb.{id}.memberLevels），普通成员只能看到 permission_level ≤ 本人分值的条目；
 * 未登记成员按 0 处理（仅可见完全公开条目）。其余部门库维持一期「成员全可见」。
 */
export const LEVEL_FILTERED_DEPT_KB_IDS: ReadonlySet<string> = new Set([
  'us-collab',
  'purchasing',
  // 2026-08 新增的 6 个部门库一律启用按人分值过滤（各部门资料需按人控制可见范围）。
  // ⚠️ 刻意不改动 gm/hr/finance/production/quality/sales —— 那几个库现有资料是「成员全可见」，
  //    改成过滤会让未登记分值的成员立刻看不到已有内容，属破坏性变更。要开需先维护好分值表。
  'after-sales',
  'rd-registration',
  'customs',
  'legal',
  'it',
  'rd-production',
]);

export const isDeptKbId = (id: string | undefined | null): boolean =>
  typeof id === 'string' && DEPT_KB_IDS.has(id);

/** 每个部门库的页面访问权限码。 */
export const deptKbPageCode = (kbId: string): string => `page:dept-kb-${kbId}`;

/** 共用一套操作权限码（按 kbId 动态判定归属，所有部门库共享同名操作码）。 */
export const DEPT_KB_OPS = {
  UPLOAD: 'dept-kb:upload',
  ENTRY_EDIT: 'dept-kb:entry:edit',
  ENTRY_MOVE: 'dept-kb:entry:move',
  ENTRY_DELETE: 'dept-kb:entry:delete',
  CATEGORY_CREATE: 'dept-kb:category:create',
  CATEGORY_EDIT: 'dept-kb:category:edit',
  CATEGORY_DELETE: 'dept-kb:category:delete',
  /** 管理权限：可设置文件权限分值、隐含全部细分操作。 */
  MANAGE: 'dept-kb:manage',
} as const;

/**
 * 新建部门库的默认分类：仅一个「其他」兜底分类，分类树由各部门管理员自建。
 * 必须保留 id='kb-other'——服务层多处回退逻辑（resolveKnowledgeCategoryId、
 * createKnowledgeEntry 默认归类、禁止删除默认类目）都依赖该固定 id。
 */
export const DEPT_KB_DEFAULT_CATEGORIES = [
  { id: 'kb-other', label: '其他', icon: 'FolderOpen', color: '#94a3b8', order: 1, children: [] },
];
