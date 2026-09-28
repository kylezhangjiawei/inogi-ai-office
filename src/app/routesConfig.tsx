import React from "react";
import { routePath, subRoutePath } from "./lib/routePaths";
import {
  Activity,
  BarChart3,
  Bot,
  BadgeCheck,
  BookOpen,
  Clapperboard,
  Palette,
  Bug,
  Building2,
  CalendarCheck2,
  CalendarDays,
  ClipboardList,
  Download,
  FileBox,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  GanttChartSquare,
  GitBranch,
  GraduationCap,
  Images,
  Inbox,
  Languages,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Mail,
  Microscope,
  MonitorCog,
  NotebookPen,
  PackageCheck,
  Presentation,
  Receipt,
  Route,
  ScanSearch,
  ShoppingCart,
  ScrollText,
  ShieldCheck,
  Store,
  Telescope,
  UserCog,
  Users,
  UserSquare2,
  Wand2,
  Warehouse,
  Waypoints,
} from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission code required to see this item. Omit for always-visible items. */
  requiredPermission?: string;
  /** 任一权限即可见（部门知识库这类「一个入口聚合多个页面码」的场景）。 */
  requiredPermissionAny?: string[];
  /** 同时要求的前提权限；不作为入口主路由或导航隐藏码。可与 Any 组合。 */
  requiredPermissionAll?: string[];
  /**
   * 除 path 外还应算作「当前项」的路径。聚合入口会把用户送到别的地址（知识库入口点进去
   * 可能落在 /rd-knowledge-base），只按 path 判定的话侧栏高亮、分组展开、滚动定位会集体失灵。
   */
  matchPaths?: string[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * 部门知识库清单。
 *
 * ⚠️ 事实源在后端 `dept-knowledge.constants.ts` 的 DEPT_KBS —— 那里同时派生出
 *    DEPARTMENT_KB_ID_BY_CODE，供部门改名级联与权限目录标签同步使用。本文件是它的前端镜像，
 *    **两边的 departmentCode 必须逐条一致**：此前 finance / purchasing 在前端漏填，导致部门改名后
 *    权限目录里的标签变了、侧边栏与页面标题却仍显示旧名。
 *
 * departmentCode 的作用：据此从部门主数据解析该库的当前显示名（nameByCode），使库名跟随部门改名。
 * 不填则固定用 label。
 *
 * id 为永久标识：路由 /dept-kb/{id}、页面码 page:dept-kb-{id}、存储键全部依赖它，确定后不可更名。
 */
export const DEPT_KBS: { id: string; label: string; departmentCode?: string }[] = [
  { id: "gm", label: "总经办", departmentCode: "GENERAL_OFFICE" },
  { id: "hr", label: "人事行政部", departmentCode: "HR_ADMIN" },
  { id: "finance", label: "财务部", departmentCode: "FINANCE" },
  { id: "purchasing", label: "采购部", departmentCode: "PURCHASING" },
  { id: "production", label: "生产部", departmentCode: "PRODUCTION" },
  { id: "quality", label: "质量部", departmentCode: "REGULATORY_QUALITY" },
  { id: "sales", label: "销售部", departmentCode: "SALES_MARKETING" },
  { id: "after-sales", label: "售后服务部", departmentCode: "AFTER_SALES" },
  { id: "rd-registration", label: "研发注册部", departmentCode: "RD_REGISTRATION" },
  { id: "customs", label: "关务单证部", departmentCode: "CUSTOMS_DOCUMENTS" },
  { id: "legal", label: "法务合同部", departmentCode: "LEGAL_CONTRACT" },
  { id: "it", label: "信息系统部", departmentCode: "IT_SYSTEM" },
  // ⚠️ 不能叫 production —— 已被生产运营部占用
  { id: "rd-production", label: "研发生产部", departmentCode: "PRODUCTION_DEPARTMENT" },
];

/**
 * 导航定义（内置默认路径）。实际生效路径见下方 navGroups —— 会按「页面路由管理」的配置解析。
 */
const BASE_NAV_GROUPS: NavGroup[] = [
  {
    label: "总览",
    items: [{ label: "系统首页", path: "/", icon: LayoutDashboard, requiredPermission: "page:dashboard" }],
  },
  {
    label: "供应链管理",
    items: [
      { label: "供应链任务驾驶舱", path: "/proc-cockpit", icon: ShoppingCart, requiredPermission: "page:proc-cockpit" },
      { label: "个人工作台", path: "/proc-my-workspace", icon: GanttChartSquare, requiredPermission: "page:proc-my-workspace" },
      { label: "物料库", path: "/proc-materials", icon: Warehouse, requiredPermission: "page:proc-materials" },
      { label: "全部关键物料", path: "/proc-key-materials", icon: ListChecks, requiredPermission: "page:proc-key-materials" },
      { label: "库存齐套中心", path: "/proc-inventory-readiness", icon: PackageCheck, requiredPermission: "page:proc-inventory-readiness" },
      { label: "供应商报价库", path: "/proc-quote-book", icon: Store, requiredPermission: "page:proc-quote-book" },
    ],
  },
  {
    label: "研发任务管理",
    items: [
      { label: "研发任务驾驶舱", path: "/rd-task-management", icon: LayoutGrid, requiredPermission: "page:rd-task-management" },
      { label: "个人工作台", path: "/rd-my-workspace", icon: GanttChartSquare, requiredPermission: "page:rd-my-workspace" },
      { label: "研发数据表", path: "/rd-sheet", icon: FileSpreadsheet, requiredPermission: "page:rd-sheet" },
      { label: "问题记录与 AI 定位", path: "/issue-ai", icon: Microscope, requiredPermission: "page:issue-ai" },
      // 「研发知识库」入口已移到下方「部门知识库」分组（仍指向 /rd-knowledge-base 原页面）
      { label: "审批流配置", path: "/rd-approval-flow", icon: GitBranch, requiredPermission: "page:rd-approval-flow" },
      { label: "研发 AI 策略", path: "/rd-ai-settings", icon: Bot, requiredPermission: "page:rd-ai-settings" },
    ],
  },
  {
    // 中美协同：美国团队使用、中国研发团队支持。驾驶舱/工作台复用研发页面（驾驶舱不含子系统全景），知识库为独立 us-collab 库。
    label: "中美协同",
    items: [
      { label: "协同任务驾驶舱", path: "/us-collab-cockpit", icon: LayoutGrid, requiredPermission: "page:us-collab-cockpit" },
      { label: "协同工作台", path: "/us-collab-workspace", icon: GanttChartSquare, requiredPermission: "page:us-collab-workspace" },
      { label: "协同知识库", path: "/us-collab-kb", icon: BookOpen, requiredPermission: "page:dept-kb-us-collab" },
      { label: "协同审批流配置", path: "/us-collab-approval-flow", icon: GitBranch, requiredPermission: "page:us-collab-approval-flow" },
      { label: "协同 AI 策略", path: "/us-collab-ai-settings", icon: Bot, requiredPermission: "page:us-collab-ai-settings" },
    ],
  },
  {
    label: "知识库",
    items: [
      // 部门库与研发库合成一个入口：进页面后默认落在自己部门的库，顶部下拉可切到其它
      // 有权限的库（含研发库）。权限码仍是每库一个，只是不再各占一个导航位；
      // 研发库点进去仍是原路由 /rd-knowledge-base，RAG/密级/任务入库等专属能力不变。
      {
        label: "知识库",
        path: "/dept-kb",
        icon: BookOpen,
        requiredPermissionAny: [
          ...DEPT_KBS.map((d) => `page:dept-kb-${d.id}`),
          "page:rd-knowledge-base",
        ],
        // 选中研发库时 URL 是 /rd-knowledge-base，不带上它侧栏就不认自己是当前项
        matchPaths: [routePath("page:rd-knowledge-base", "/rd-knowledge-base")],
      },
    ],
  },
  {
    label: "信息流转",
    items: [
      { label: "售后 Case 管理", path: "/after-sales", icon: ClipboardList, requiredPermission: "page:after-sales" },
      { label: "研发问题分流", path: "/rd-triage", icon: Waypoints, requiredPermission: "page:rd-triage" },
      { label: "注册项目里程碑", path: "/registration-projects", icon: GanttChartSquare, requiredPermission: "page:registration-projects" },
      { label: "BOM 确认存档", path: "/bom-archive", icon: FileBox, requiredPermission: "page:bom-archive" },
      { label: "设计开发变更", path: "/design-changes", icon: ScrollText, requiredPermission: "page:design-changes" },
    ],
  },
  {
    label: "文件与知识",
    items: [
      { label: "报关单证 AI", path: "/customs-ai", icon: FileSearch, requiredPermission: "page:customs-ai" },
      { label: "报关单证处理", path: "/customs-docs", icon: ScanSearch, requiredPermission: "page:customs-docs" },
      { label: "对外资料版本", path: "/external-docs", icon: FolderKanban, requiredPermission: "page:external-docs" },
      { label: "法规知识库", path: "/ra-knowledge", icon: BookOpen, requiredPermission: "page:ra-knowledge" },
      { label: "质量文件 DMS", path: "/quality-dms", icon: ShieldCheck, requiredPermission: "page:quality-dms" },
      { label: "全链路追溯", path: "/qa-traceability", icon: BadgeCheck, requiredPermission: "page:qa-traceability" },
    ],
  },
  {
    label: "订单与库存",
    items: [
      { label: "仓库工作台", path: "/warehouse-flow", icon: Warehouse, requiredPermission: "page:warehouse-flow", requiredPermissionAny: ["page:warehouse-flow", "page:production-execution"] },
      { label: "订货单处理工作台", path: "/order-workbench", icon: PackageCheck, requiredPermission: "page:order-workbench" },
      { label: "采购订单", path: "/purchase-orders", icon: ShoppingCart, requiredPermission: "page:purchase-orders" },
      { label: "库存管理", path: "/inventory-management", icon: Warehouse, requiredPermission: "page:inventory-management" },
    ],
  },
  {
    label: "AI 创作",
    items: [
      { label: "AI 图像生成", path: "/ui-design", icon: Wand2, requiredPermission: "page:ui-design" },
      { label: "图像作品库", path: "/image-library", icon: Images, requiredPermission: "page:image-library" },
      { label: "视频作品库", path: "/video-library", icon: Clapperboard, requiredPermission: "page:video-library" },
    ],
  },
  {
    label: "沟通协同",
    items: [
      { label: "多渠道询盘", path: "/inquiry", icon: Inbox, requiredPermission: "page:inquiry" },
      { label: "会议纪要", path: "/meeting", icon: NotebookPen, requiredPermission: "page:meeting" },
      { label: "邮件 AI 写作", path: "/email-ai", icon: Mail, requiredPermission: "page:email-ai" },
      { label: "汇报材料压缩", path: "/report-compression", icon: Presentation, requiredPermission: "page:report-compression" },
    ],
  },
  {
    label: "人事与行政",
    items: [
      { label: "简历筛选", path: "/resume-screening", icon: GraduationCap, requiredPermission: "page:resume-screening" },
      { label: "应聘登记", path: "/applicant-forms", icon: ClipboardList, requiredPermission: "page:applicant-forms" },
      { label: "员工入职归档", path: "/employee-archive", icon: Users, requiredPermission: "page:employee-archive" },
      { label: "人员考勤", path: "/attendance", icon: CalendarCheck2, requiredPermission: "page:quick-capture" },
      { label: "费用报销统计", path: "/expense-center", icon: Receipt, requiredPermission: "page:expense-center" },
    ],
  },
  {
    label: "质量与生产",
    items: [
      // 复用原主管驾驶舱的完整能力与权限码，避免既有角色授权和历史链接失效。
      { label: "生产驾驶舱", path: "/production-dashboard", icon: Telescope, requiredPermission: "page:rd-director-dashboard" },
      { label: "生产计划与执行", path: "/production-execution", icon: CalendarDays, requiredPermission: "page:production-execution" },
      { label: "电子批记录", path: "/ebpr", icon: ListChecks, requiredPermission: "page:ebpr" },
      { label: "检验与放行", path: "/inspection-release", icon: BadgeCheck, requiredPermission: "page:inspection-release" },
      { label: "BUG 日志分析", path: "/bug-log", icon: Bug, requiredPermission: "page:bug-log" },
    ],
  },
  {
    label: "法务管理",
    items: [
      { label: "合同 AI 审查", path: "/contract-review", icon: FileText, requiredPermission: "page:contract-review" },
    ],
  },
  {
    label: "系统运维中心",
    items: [
      { label: "运维总览", path: "/ops-center", icon: Activity, requiredPermission: "page:ops-center" },
      { label: "接口与错误", path: "/ops-center/api-errors", icon: Bug, requiredPermission: "page:ops-api-errors" },
      { label: "数据库监控", path: "/ops-center/database", icon: Building2, requiredPermission: "page:ops-database" },
      { label: "服务与任务", path: "/ops-center/services-tasks", icon: Bot, requiredPermission: "page:ops-services-tasks" },
      { label: "告警与审计设置", path: "/ops-center/alerts-audit", icon: ShieldCheck, requiredPermission: "page:ops-alerts-audit" },
    ],
  },
  {
    label: "系统管理",
    items: [
      { label: "电子闸门", path: "/electronic-gate", icon: ShieldCheck, requiredPermission: "page:electronic-gate" },
      { label: "设备检测记录", path: "/device-inspection-records", icon: ClipboardList, requiredPermission: "page:device-inspection-records" },
      { label: "邮箱管理", path: "/mailbox-management", icon: Mail, requiredPermission: "page:mailbox-management" },
      { label: "AI模型管理", path: "/ai-model-management", icon: Bot, requiredPermission: "page:ai-model-management" },
      { label: "AI使用情况", path: "/ai-usage", icon: BarChart3, requiredPermission: "page:ai-usage-dashboard" },
      { label: "运营素材管理", path: "/content-slots", icon: Palette, requiredPermission: "page:content-slots" },
      { label: "AI使用与反馈", path: "/chat-analytics", icon: BarChart3, requiredPermission: "page:chat-analytics" },
      { label: "翻译管理", path: "/i18n-management", icon: Languages, requiredPermission: "i18n:manage" },
      { label: "腾讯OCR配置", path: "/ocr-config-management", icon: ScanSearch, requiredPermission: "page:ocr-config-management" },
      { label: "下载和教程", path: "/downloads", icon: Download, requiredPermission: "page:downloads" },
      { label: "操作手册", path: "/manual", icon: BookOpen, requiredPermission: "page:manual" },
      { label: "部门管理", path: "/departments", icon: Building2, requiredPermission: "page:departments" },
      { label: "用户管理", path: "/users", icon: UserSquare2, requiredPermission: "page:users" },
      { label: "角色权限", path: "/roles", icon: UserCog, requiredPermission: "page:roles" },
      // 研发 / 中美协同 / 采购三个「操作留痕」入口合并到这里：一个页面、一个页面码，
      // 模块在页内下拉切换；旧地址仍可访问，会重定向过来并预选对应模块。
      { label: "操作留痕", path: "/audit-log", icon: ShieldCheck, requiredPermission: "page:audit-log" },
      { label: "页面路由管理", path: "/route-management", icon: Route, requiredPermission: "page:route-management" },
      { label: "字典列表", path: "/settings", icon: MonitorCog, requiredPermission: "page:settings" },
    ],
  },
];

/**
 * 生效的导航分组：路径按各项 requiredPermission 从「页面路由管理」解析，
 * 目录无配置或值非法时回退到上面的内置默认路径。
 * 在导出处统一解析（而非逐条改写 70 多个字面量），改一处即全量生效，也不会漏改。
 */
export const navGroups: NavGroup[] = BASE_NAV_GROUPS.map((group) => ({
  ...group,
  items: group.items.map((item) =>
    item.requiredPermission
      ? { ...item, path: routePath(item.requiredPermission, item.path) }
      : item,
  ),
}));

/**
 * 当前页是否属于该导航项。侧栏的高亮、分组自动展开、激活项滚动定位三处都用它，
 * 各写各的判定迟早跑偏——聚合入口就是这么漏掉 /rd-knowledge-base 的。
 *
 * 首页与运维中心走精确匹配（否则所有子路径都会把它们点亮），其余按前缀匹配子路由。
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const exactOnly = item.path === "/" || item.path === "/ops-center";
  const matches = (target: string) =>
    pathname === target || (!exactOnly && target !== "/" && pathname.startsWith(`${target}/`));
  return matches(item.path) || (item.matchPaths?.some(matches) ?? false);
}

export const routeTitleMap = navGroups
  .flatMap((group) => group.items)
  .reduce<Record<string, string>>((acc, item) => {
    acc[item.path] = item.label;
    return acc;
  }, {
    // 下面这些不进侧栏，但需要面包屑标题。
    [routePath("page:warehouse-count", "/warehouse-count")]: "库存盘点",
    [subRoutePath("page:warehouse-flow", "/warehouse-flow", "shipments")]: "实际出货记录",
    [subRoutePath("page:proc-materials", "/proc-materials", "bom")]: "BOM清单",
    // 研发知识库并入统一入口后不再有自己的导航项，这里必须同样走 routePath 解析——
    // 写死默认路径的话，「页面路由管理」改掉它的访问路径，面包屑就退回「系统首页」。
    [routePath("page:rd-knowledge-base", "/rd-knowledge-base")]: "研发知识库",
    "/profile": "个人中心",
    "/message-center": "消息中心",
    "/us-collab-task": "协同任务详情",
    "/rd-task": "研发任务详情",
    "/production-task": "生产任务详情",
    "/rd-people-management": "研发人员管理",
    "/proc-people-management": "供应链人员管理",
    "/us-collab-people-management": "协同人员管理",
    "/production-people-management": "生产人员管理",
    "/ops-center/api-errors": "接口与错误",
    "/ops-center/database": "数据库监控",
    "/ops-center/services-tasks": "服务与任务",
    "/ops-center/alerts-audit": "告警与审计设置",
    "/route-management": "页面路由管理",
  });

/** Map from route path to required permission code. */
export const routePermissionMap = navGroups
  .flatMap((group) => group.items)
  .reduce<Record<string, string>>((acc, item) => {
    if (item.requiredPermission) {
      acc[item.path] = item.requiredPermission;
    }
    return acc;
  }, {});
