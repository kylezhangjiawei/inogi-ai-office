import React from "react";
import {
  Activity,
  Bot,
  BadgeCheck,
  BookOpen,
  Bug,
  Building2,
  ClipboardList,
  Download,
  FileBox,
  FileSearch,
  FileText,
  FolderKanban,
  GanttChartSquare,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Mail,
  MessageSquareText,
  MonitorCog,
  NotebookPen,
  Presentation,
  Receipt,
  Route,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Telescope,
  UserCog,
  Users,
  UserSquare2,
  Wand2,
  Waypoints,
} from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission code required to see this item. Omit for always-visible items. */
  requiredPermission?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    label: "总览",
    items: [{ label: "系统首页", path: "/", icon: LayoutDashboard, requiredPermission: "page:dashboard" }],
  },
  {
    label: "研发任务管理",
    items: [
      { label: "研发任务驾驶舱", path: "/rd-task-management", icon: LayoutGrid, requiredPermission: "page:rd-task-management" },
      { label: "个人工作台", path: "/rd-my-workspace", icon: GanttChartSquare, requiredPermission: "page:rd-my-workspace" },
      { label: "厂长驾驶舱", path: "/rd-director-dashboard", icon: Telescope, requiredPermission: "page:rd-director-dashboard" },
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
    label: "AI 创作",
    items: [
      { label: "UI 设计生成", path: "/ui-design", icon: Wand2, requiredPermission: "page:ui-design" },
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
      { label: "随手记任务分流", path: "/quick-capture", icon: MessageSquareText, requiredPermission: "page:quick-capture" },
      { label: "费用报销统计", path: "/expense-center", icon: Receipt, requiredPermission: "page:expense-center" },
    ],
  },
  {
    label: "质量与生产",
    items: [
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
      { label: "下载和教程", path: "/downloads", icon: Download, requiredPermission: "page:downloads" },
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
