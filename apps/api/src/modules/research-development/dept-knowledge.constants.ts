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

export type DeptKbDef = { id: string; label: string };

/** 8 个部门固定硬编码（不绑定 DB 的 Department 表——后者与此清单对不上）。 */
export const DEPT_KBS: DeptKbDef[] = [
  { id: 'gm', label: '总经办' },
  { id: 'hr', label: '人事行政部' },
  { id: 'finance', label: '财务部' },
  { id: 'purchasing', label: '采购部' },
  { id: 'production', label: '生产部' },
  { id: 'tech-rd', label: '技术研发部' },
  { id: 'quality', label: '质量部' },
  { id: 'sales', label: '销售部' },
];

export const DEPT_KB_IDS: ReadonlySet<string> = new Set(DEPT_KBS.map((d) => d.id));

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
