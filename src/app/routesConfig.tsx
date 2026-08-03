import React from "react";
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
  /** 绑定部门主数据时使用稳定 code 动态解析当前名称。 */
  departmentCode?: string;
  /** Permission code required to see this item. Omit for always-visible items. */
  requiredPermission?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * 部门知识库清单（与后端 dept-knowledge.constants.ts 的 DEPT_KBS 保持一致）。
 * id 为永久标识：路由 /dept-kb/{id}、页面码 page:dept-kb-{id}、存储键全部依赖它，确定后不可更名。
 */
export const DEPT_KBS: { id: string; label: string; departmentCode?: string }[] = [
  { id: "gm", label: "总经办", departmentCode: "GENERAL_OFFICE" },
  { id: "hr", label: "人事行政部", departmentCode: "HR_ADMIN" },
  { id: "finance", label: "财务部" },
  { id: "purchasing", label: "采购部" },
  { id: "production", label: "生产部", departmentCode: "PRODUCTION" },
  { id: "quality", label: "质量部", departmentCode: "REGULATORY_QUALITY" },
  { id: "sales", label: "销售部", departmentCode: "SALES_MARKETING" },
];

export const navGroups: NavGroup[] = [
  {
    label: "总览",
    items: [{ label: "系统首页", path: "/", icon: LayoutDashboard, requiredPermission: "page:dashboard" }],
  },
  {
    label: "采购管理",
    items: [
      { label: "采购任务驾驶舱", path: "/proc-cockpit", icon: ShoppingCart, requiredPermission: "page:proc-cockpit" },
      { label: "个人工作台", path: "/proc-my-workspace", icon: GanttChartSquare, requiredPermission: "page:proc-my-workspace" },
      { label: "物料库", path: "/proc-materials", icon: Warehouse, requiredPermission: "page:proc-materials" },
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
      { label: "操作留痕", path: "/rd-audit-log", icon: ShieldCheck, requiredPermission: "page:rd-audit-log" },
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
      { label: "协同操作留痕", path: "/us-collab-audit-log", icon: ShieldCheck, requiredPermission: "page:us-collab-audit-log" },
      { label: "协同 AI 策略", path: "/us-collab-ai-settings", icon: Bot, requiredPermission: "page:us-collab-ai-settings" },
    ],
  },
  {
    label: "部门知识库",
    items: [
      ...DEPT_KBS.map((d) => ({
        label: `${d.label}知识库`,
        path: `/dept-kb/${d.id}`,
        icon: BookOpen,
        departmentCode: d.departmentCode,
        requiredPermission: `page:dept-kb-${d.id}`,
      })),
      // 「研发知识库」并入本组展示：点击仍跳转到原全功能页 /rd-knowledge-base（RAG/密级/任务入库等不变）。
      // 技术研发部不再单设部门库，统一用研发知识库。
      { label: "研发知识库", path: "/rd-knowledge-base", icon: BookOpen, requiredPermission: "page:rd-knowledge-base" },
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
      { label: "页面路由管理", path: "/route-management", icon: Route, requiredPermission: "page:route-management" },
      { label: "字典列表", path: "/settings", icon: MonitorCog, requiredPermission: "page:settings" },
    ],
  },
];

export const routeTitleMap = navGroups
  .flatMap((group) => group.items)
  .reduce<Record<string, string>>((acc, item) => {
    acc[item.path] = item.label;
    return acc;
  }, {
    "/profile": "个人中心",
    "/message-center": "消息中心",
    "/us-collab-task": "协同任务详情",
    "/rd-task": "研发任务详情",
    "/production-task": "生产任务详情",
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
