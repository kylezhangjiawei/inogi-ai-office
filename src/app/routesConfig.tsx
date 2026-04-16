import React from "react";
import {
  BadgeCheck,
  BookOpen,
  Bug,
  ClipboardList,
  FileBox,
  FileSearch,
  FileText,
  FolderKanban,
  GanttChartSquare,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Mail,
  NotebookPen,
  MessageSquareText,
  MonitorCog,
  Presentation,
  Receipt,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
  UserSquare2,
  Waypoints,
} from "lucide-react";

export type NavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  { label: "总览", items: [{ label: "系统首页", path: "/", icon: LayoutDashboard }] },
  {
    label: "信息流转",
    items: [
      { label: "售后 Case 管理", path: "/after-sales", icon: ClipboardList },
      { label: "研发问题分流", path: "/rd-triage", icon: Waypoints },
      { label: "注册项目里程碑", path: "/registration-projects", icon: GanttChartSquare },
      { label: "BOM 确认存档", path: "/bom-archive", icon: FileBox },
      { label: "设计开发变更", path: "/design-changes", icon: ScrollText },
    ],
  },
  {
    label: "文件与知识",
    items: [
      { label: "报关单证 AI", path: "/customs-ai", icon: FileSearch },
      { label: "对外资料版本", path: "/external-docs", icon: FolderKanban },
      { label: "法规知识库", path: "/ra-knowledge", icon: BookOpen },
      { label: "质量文件 DMS", path: "/quality-dms", icon: ShieldCheck },
    ],
  },
  {
    label: "沟通协同",
    items: [
      { label: "多渠道询盘", path: "/inquiry", icon: Inbox },
      { label: "会议纪要", path: "/meeting", icon: NotebookPen },
      { label: "邮件 AI 写作", path: "/email-ai", icon: Mail },
      { label: "汇报材料压缩", path: "/report-compression", icon: Presentation },
    ],
  },
  {
    label: "人事与行政",
    items: [
      { label: "简历筛选", path: "/resume-screening", icon: GraduationCap },
      { label: "员工入职归档", path: "/employee-archive", icon: Users },
      { label: "随手记任务分配", path: "/quick-capture", icon: MessageSquareText },
      { label: "费用报销统计", path: "/expense-center", icon: Receipt },
    ],
  },
  {
    label: "质量与生产",
    items: [
      { label: "电子批记录", path: "/ebpr", icon: ListChecks },
      { label: "检验与放行", path: "/inspection-release", icon: BadgeCheck },
      { label: "BUG 日志分析", path: "/bug-log", icon: Bug },
    ],
  },
  {
    label: "法务与系统",
    items: [
      { label: "合同 AI 审查", path: "/contract-review", icon: FileText },
      { label: "用户管理", path: "/users", icon: UserSquare2 },
      { label: "角色权限", path: "/roles", icon: UserCog },
      { label: "系统设置", path: "/settings", icon: MonitorCog },
    ],
  },
];

export const routeTitleMap = navGroups.flatMap((group) => group.items).reduce<Record<string, string>>((acc, item) => {
  acc[item.path] = item.label;
  return acc;
}, {});
