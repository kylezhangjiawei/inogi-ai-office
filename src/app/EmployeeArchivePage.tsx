import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  FileCheck2,
  IdCard,
  Image as ImageIcon,
  MapPin,
  Move,
  Pencil,
  Printer,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import badgeInternTemplate from "../assets/employee-archive/badge-intern.jpeg";
import badgeLaborTemplate from "../assets/employee-archive/badge-labor.jpeg";
import badgeOfficialTemplate from "../assets/employee-archive/badge-official.jpeg";
import { cn } from "./components/ui/utils";

type ArchiveStatus = "complete" | "review" | "missing" | "onboarding";
type DocStatus = "done" | "review" | "missing";
type FieldGroupKey = "employment" | "identity" | "contact" | "payroll";
type BadgeTemplateKey = "official" | "intern" | "labor";
type BadgeOverlayKey = "name" | "departmentCaption" | "department" | "title" | "photo" | "employeeId";
type BadgeRequirementStatus = "ready" | "warning" | "missing";

interface DocItem {
  title: string;
  source: string;
  status: DocStatus;
  detail: string;
  updatedAt: string;
}

interface EmployeeArchive {
  id: string;
  rosterNo: string;
  company: string;
  hireDate: string;
  settlementDate: string;
  tenure: string;
  status: string;
  workLocation: string;
  department: string;
  title: string;
  name: string;
  idNoMasked: string;
  birthDate: string;
  birthMonthDay: string;
  zodiac: string;
  gender: string;
  age: number;
  ethnicity: string;
  maritalStatus: string;
  phoneMasked: string;
  bankAccountMasked: string;
  bankBranch: string;
  education: string;
  school: string;
  major: string;
  hometown: string;
  registeredAddress: string;
  currentAddress: string;
  emergencyContact: string;
  emergencyRelation: string;
  emergencyPhoneMasked: string;
  socialSecurityNo: string;
  socialSecurityFirstMonth: string;
  note: string;
  costCenter: string;
  archiveStatus: ArchiveStatus;
  archiveScore: number;
  missingFields: string[];
  alerts: string[];
  docs: DocItem[];
}

interface FieldItem {
  label: string;
  value: string | number;
  sensitive?: boolean;
}

interface BadgeRequirement {
  label: string;
  value: string;
  helper: string;
  status: BadgeRequirementStatus;
  required: boolean;
}

interface BadgeTemplate {
  key: BadgeTemplateKey;
  name: string;
  sourceFile: string;
  frontImage: string;
  primary: string;
}

interface BadgeOverlayPosition {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BadgeAvatarDraft {
  dataUrl?: string;
  fileName?: string;
  updatedAt?: string;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  rotate: number;
  radius: number;
  savedLocal: boolean;
}

type BadgeOverlayPositions = Record<BadgeOverlayKey, BadgeOverlayPosition>;
type BadgeLayoutPositions = Record<BadgeTemplateKey, BadgeOverlayPositions>;

const archiveEmployees: EmployeeArchive[] = [
  {
    id: "EA-001",
    rosterNo: "001",
    company: "壹诺吉",
    hireDate: "2024-03-04",
    settlementDate: "2024-03-31",
    tenure: "2年4个月",
    status: "在职",
    workLocation: "上海",
    department: "研发部",
    title: "注册工程师",
    name: "林予安",
    idNoMasked: "3205**********1426",
    birthDate: "1994-08-12",
    birthMonthDay: "08-12",
    zodiac: "狗",
    gender: "女",
    age: 31,
    ethnicity: "汉族",
    maritalStatus: "已婚",
    phoneMasked: "138****6412",
    bankAccountMasked: "6217 **** **** 9038",
    bankBranch: "中国银行上海张江支行",
    education: "硕士",
    school: "东华大学",
    major: "生物医学工程",
    hometown: "江苏苏州",
    registeredAddress: "江苏省苏州市工业园区",
    currentAddress: "上海市浦东新区张江",
    emergencyContact: "陈女士",
    emergencyRelation: "母亲",
    emergencyPhoneMasked: "139****2281",
    socialSecurityNo: "SH-202403-018",
    socialSecurityFirstMonth: "2024-04",
    note: "入职资料已完成电子归档",
    costCenter: "研发项目组",
    archiveStatus: "complete",
    archiveScore: 100,
    missingFields: [],
    alerts: ["劳动合同次年复核：2027-03-03"],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 民族", status: "done", detail: "证件字段完整，号码已脱敏展示", updatedAt: "2026-06-18" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "done", detail: "学历证明与花名册字段一致", updatedAt: "2026-06-18" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "done", detail: "已与中国银行卡号表核对", updatedAt: "2026-06-20" },
      { title: "社保首月", source: "社保号 / 社保首月日期", status: "done", detail: "首月日期与结算日期匹配", updatedAt: "2026-06-20" },
    ],
  },
  {
    id: "EA-002",
    rosterNo: "002",
    company: "益雍君",
    hireDate: "2025-09-15",
    settlementDate: "2025-09-30",
    tenure: "9个月",
    status: "在职",
    workLocation: "上海",
    department: "质量部",
    title: "质量体系专员",
    name: "周庭序",
    idNoMasked: "3412**********6173",
    birthDate: "1998-02-09",
    birthMonthDay: "02-09",
    zodiac: "虎",
    gender: "男",
    age: 28,
    ethnicity: "汉族",
    maritalStatus: "未婚",
    phoneMasked: "186****5049",
    bankAccountMasked: "待补充",
    bankBranch: "待补充",
    education: "本科",
    school: "安徽医科大学",
    major: "医学检验技术",
    hometown: "安徽合肥",
    registeredAddress: "安徽省合肥市蜀山区",
    currentAddress: "上海市闵行区虹桥",
    emergencyContact: "周先生",
    emergencyRelation: "父亲",
    emergencyPhoneMasked: "137****3180",
    socialSecurityNo: "SH-202510-041",
    socialSecurityFirstMonth: "2025-10",
    note: "工资卡开户行待员工确认",
    costCenter: "质量体系",
    archiveStatus: "missing",
    archiveScore: 82,
    missingFields: ["银行帐号", "工资卡开户行全称"],
    alerts: ["工资卡信息缺失影响结算", "中国银行卡号表未匹配到账号"],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 性别", status: "done", detail: "基础身份字段完整", updatedAt: "2026-06-19" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "done", detail: "专业字段已归档", updatedAt: "2026-06-19" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "missing", detail: "账号与支行缺失，需补扫工资卡信息", updatedAt: "2026-06-25" },
      { title: "社保首月", source: "社保号 / 社保首月日期", status: "done", detail: "社保号与首月日期完整", updatedAt: "2026-06-19" },
    ],
  },
  {
    id: "EA-003",
    rosterNo: "003",
    company: "壹诺吉",
    hireDate: "2026-05-06",
    settlementDate: "2026-05-31",
    tenure: "1个月",
    status: "试用期",
    workLocation: "苏州",
    department: "生产部",
    title: "设备技术员",
    name: "许洛川",
    idNoMasked: "5101**********3918",
    birthDate: "2000-11-02",
    birthMonthDay: "11-02",
    zodiac: "龙",
    gender: "男",
    age: 25,
    ethnicity: "汉族",
    maritalStatus: "未婚",
    phoneMasked: "152****0764",
    bankAccountMasked: "6216 **** **** 2207",
    bankBranch: "中国银行苏州工业园区支行",
    education: "大专",
    school: "苏州工业职业技术学院",
    major: "机电一体化",
    hometown: "四川成都",
    registeredAddress: "四川省成都市武侯区",
    currentAddress: "苏州市工业园区唯亭",
    emergencyContact: "许女士",
    emergencyRelation: "姐姐",
    emergencyPhoneMasked: "180****4105",
    socialSecurityNo: "待确认",
    socialSecurityFirstMonth: "待确认",
    note: "社保首月待人事确认",
    costCenter: "生产制造",
    archiveStatus: "review",
    archiveScore: 88,
    missingFields: ["社保号", "社保首月日期"],
    alerts: ["试用期归档需在 2026-08-05 前完成复核", "社保首月字段待确认"],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 年龄", status: "done", detail: "证件字段完整", updatedAt: "2026-06-03" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "review", detail: "学历证扫描件清晰度偏低", updatedAt: "2026-06-05" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "done", detail: "工资卡信息已匹配", updatedAt: "2026-06-05" },
      { title: "社保首月", source: "社保号 / 社保首月日期", status: "missing", detail: "首月参保日期待录入", updatedAt: "2026-06-25" },
    ],
  },
  {
    id: "EA-004",
    rosterNo: "004",
    company: "益雍君",
    hireDate: "2026-06-24",
    settlementDate: "2026-06-30",
    tenure: "待转正",
    status: "待入职归档",
    workLocation: "上海",
    department: "市场部",
    title: "商务助理",
    name: "唐亦禾",
    idNoMasked: "4401**********8820",
    birthDate: "2002-04-22",
    birthMonthDay: "04-22",
    zodiac: "马",
    gender: "女",
    age: 24,
    ethnicity: "汉族",
    maritalStatus: "未婚",
    phoneMasked: "131****8125",
    bankAccountMasked: "待补充",
    bankBranch: "待补充",
    education: "本科",
    school: "广东外语外贸大学",
    major: "商务英语",
    hometown: "广东广州",
    registeredAddress: "广东省广州市天河区",
    currentAddress: "待补充",
    emergencyContact: "待补充",
    emergencyRelation: "待补充",
    emergencyPhoneMasked: "待补充",
    socialSecurityNo: "待确认",
    socialSecurityFirstMonth: "待确认",
    note: "新入职资料待集中归档",
    costCenter: "市场运营",
    archiveStatus: "onboarding",
    archiveScore: 56,
    missingFields: ["常住地址", "紧急联系人姓名", "紧急联系人关系", "紧急联系人手机", "银行帐号", "社保号"],
    alerts: ["新入职资料缺项较多", "紧急联系人信息未留存"],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 民族", status: "done", detail: "证件主字段已录入", updatedAt: "2026-06-24" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "done", detail: "学历字段已录入", updatedAt: "2026-06-24" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "missing", detail: "工资卡信息待员工提交", updatedAt: "2026-06-25" },
      { title: "紧急联系人", source: "紧急联系人姓名 / 关系 / 手机", status: "missing", detail: "联系人三项均未填写", updatedAt: "2026-06-25" },
    ],
  },
];

const statusMeta: Record<ArchiveStatus, { label: string; className: string; dotClassName: string }> = {
  complete: {
    label: "归档完成",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dotClassName: "bg-emerald-500",
  },
  review: {
    label: "待复核",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    dotClassName: "bg-amber-500",
  },
  missing: {
    label: "缺项待补",
    className: "border-red-200 bg-red-50 text-red-700",
    dotClassName: "bg-red-500",
  },
  onboarding: {
    label: "入职中",
    className: "border-sky-200 bg-sky-50 text-sky-700",
    dotClassName: "bg-sky-500",
  },
};

const docStatusMeta: Record<DocStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  done: {
    label: "已归档",
    className: "bg-emerald-50 text-emerald-700",
    Icon: CheckCircle2,
  },
  review: {
    label: "待复核",
    className: "bg-amber-50 text-amber-700",
    Icon: AlertTriangle,
  },
  missing: {
    label: "待补充",
    className: "bg-red-50 text-red-700",
    Icon: XCircle,
  },
};

const fieldGroups: Array<{
  key: FieldGroupKey;
  title: string;
  description: string;
  Icon: typeof Users;
  getFields: (employee: EmployeeArchive) => FieldItem[];
}> = [
  {
    key: "employment",
    title: "组织与入职",
    description: "对应在职员工表 A-J、AH 列",
    Icon: Building2,
    getFields: (employee) => [
      { label: "序号", value: employee.rosterNo },
      { label: "隶属", value: employee.company },
      { label: "状态", value: employee.status },
      { label: "工作地", value: employee.workLocation },
      { label: "部门", value: employee.department },
      { label: "职务", value: employee.title },
      { label: "入职日期", value: employee.hireDate },
      { label: "结算日期", value: employee.settlementDate },
      { label: "工龄", value: employee.tenure },
      { label: "费用归属", value: employee.costCenter },
    ],
  },
  {
    key: "identity",
    title: "身份与学历",
    description: "对应证件、出生、学历、毕业院校字段",
    Icon: IdCard,
    getFields: (employee) => [
      { label: "姓名", value: employee.name },
      { label: "证件号码", value: employee.idNoMasked, sensitive: true },
      { label: "出生日期", value: employee.birthDate },
      { label: "出生月日", value: employee.birthMonthDay },
      { label: "生肖", value: employee.zodiac },
      { label: "性别", value: employee.gender },
      { label: "年龄", value: employee.age },
      { label: "民族", value: employee.ethnicity },
      { label: "婚姻状况", value: employee.maritalStatus },
      { label: "学历", value: employee.education },
      { label: "毕业院校", value: employee.school },
      { label: "专业", value: employee.major },
    ],
  },
  {
    key: "contact",
    title: "地址与联系人",
    description: "对应籍贯、户籍地址、常住地址、紧急联系人",
    Icon: MapPin,
    getFields: (employee) => [
      { label: "手机号码", value: employee.phoneMasked, sensitive: true },
      { label: "籍贯", value: employee.hometown },
      { label: "户籍地址", value: employee.registeredAddress },
      { label: "常住地址", value: employee.currentAddress },
      { label: "紧急联系人姓名", value: employee.emergencyContact },
      { label: "紧急联系人关系", value: employee.emergencyRelation },
      { label: "紧急联系人手机", value: employee.emergencyPhoneMasked, sensitive: true },
      { label: "备注", value: employee.note },
    ],
  },
  {
    key: "payroll",
    title: "银行与社保",
    description: "对应银行帐号、开户行、社保号、社保首月日期",
    Icon: Banknote,
    getFields: (employee) => [
      { label: "银行帐号", value: employee.bankAccountMasked, sensitive: true },
      { label: "工资卡开户行全称", value: employee.bankBranch },
      { label: "社保号", value: employee.socialSecurityNo, sensitive: true },
      { label: "社保首月日期", value: employee.socialSecurityFirstMonth },
      { label: "费用归属", value: employee.costCenter },
    ],
  },
];

const sheetFields = [
  "隶属",
  "入职日期",
  "结算日期",
  "工龄",
  "状态",
  "工作地",
  "部门",
  "职务",
  "姓名",
  "证件号码",
  "手机号码",
  "银行帐号",
  "工资卡开户行全称",
  "学历",
  "毕业院校",
  "专业",
  "户籍地址",
  "常住地址",
  "紧急联系人",
  "社保首月日期",
  "费用归属",
];

const BADGE_PRINT_SIZE = "154 x 245";
const BADGE_AVATAR_STORAGE_KEY = "employee-archive-badge-avatar-drafts";

const badgeTemplates: BadgeTemplate[] = [
  {
    key: "official",
    name: "正式",
    sourceFile: "正式.jpeg",
    frontImage: badgeOfficialTemplate,
    primary: "#253151",
  },
  {
    key: "intern",
    name: "实习期",
    sourceFile: "实习期.jpeg",
    frontImage: badgeInternTemplate,
    primary: "#80b2d6",
  },
  {
    key: "labor",
    name: "劳务",
    sourceFile: "劳务.jpeg",
    frontImage: badgeLaborTemplate,
    primary: "#f2a13a",
  },
];

const getBadgeTemplate = (key: BadgeTemplateKey) =>
  badgeTemplates.find((template) => template.key === key) ?? badgeTemplates[0];

const createBadgeOverlayPositions = (): BadgeOverlayPositions => ({
  name: { left: 10, top: 15.5, width: 42, height: 5.6 },
  departmentCaption: { left: 10, top: 25, width: 24, height: 3.4 },
  department: { left: 10, top: 28, width: 46, height: 4.2 },
  title: { left: 10, top: 33, width: 46, height: 4.2 },
  photo: { left: 63, top: 9, width: 28.2, height: 24.8 },
  employeeId: { left: 10, top: 82, width: 40, height: 4.8 },
});

const createBadgeLayoutPositions = (): BadgeLayoutPositions => ({
  official: createBadgeOverlayPositions(),
  intern: createBadgeOverlayPositions(),
  labor: createBadgeOverlayPositions(),
});

const createBadgePositionConfirmed = (): Record<BadgeTemplateKey, boolean> => ({
  official: false,
  intern: false,
  labor: false,
});

const createBadgeAvatarDraft = (): BadgeAvatarDraft => ({
  imageWidth: 100,
  imageHeight: 100,
  offsetX: 0,
  offsetY: 0,
  rotate: 0,
  radius: 14,
  savedLocal: false,
});

const normalizeBadgeAvatarDraft = (draft?: Partial<BadgeAvatarDraft>): BadgeAvatarDraft => ({
  ...createBadgeAvatarDraft(),
  ...draft,
  imageWidth: Number(draft?.imageWidth ?? 100),
  imageHeight: Number(draft?.imageHeight ?? 100),
  offsetX: Number(draft?.offsetX ?? 0),
  offsetY: Number(draft?.offsetY ?? 0),
  rotate: Number(draft?.rotate ?? 0),
  radius: Number(draft?.radius ?? 14),
  savedLocal: Boolean(draft?.savedLocal),
});

const loadBadgeAvatarDrafts = (): Record<string, BadgeAvatarDraft> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(BADGE_AVATAR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<BadgeAvatarDraft>>;
    return Object.fromEntries(
      Object.entries(parsed).map(([employeeId, draft]) => [employeeId, normalizeBadgeAvatarDraft(draft)]),
    );
  } catch {
    return {};
  }
};

const persistBadgeAvatarDrafts = (drafts: Record<string, BadgeAvatarDraft>) => {
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(BADGE_AVATAR_STORAGE_KEY, JSON.stringify(drafts));
    return true;
  } catch {
    return false;
  }
};

const badgeRequirementMeta: Record<
  BadgeRequirementStatus,
  { label: string; className: string; iconClassName: string; Icon: typeof CheckCircle2 }
> = {
  ready: {
    label: "已完成",
    className: "border-emerald-100 bg-emerald-50 text-emerald-700",
    iconClassName: "text-emerald-600",
    Icon: CheckCircle2,
  },
  warning: {
    label: "需确认",
    className: "border-amber-100 bg-amber-50 text-amber-700",
    iconClassName: "text-amber-600",
    Icon: AlertTriangle,
  },
  missing: {
    label: "待补",
    className: "border-red-100 bg-red-50 text-red-700",
    iconClassName: "text-red-600",
    Icon: XCircle,
  },
};

const departmentEnglish: Record<string, string> = {
  总经办: "Executive Office",
  研发部: "Research & Development",
  质量部: "Quality Assurance",
  生产部: "Production",
  市场部: "Marketing",
};

const getBadgeEmployeeId = (employee: EmployeeArchive) => {
  const prefix = employee.company === "益雍君" ? "YYJ" : "INOGI";
  return `${prefix} - ${employee.rosterNo.padStart(3, "0")}`;
};

const getValueTone = (employee: EmployeeArchive, label: string, value: string | number) => {
  if (employee.missingFields.includes(label) || value === "待补充" || value === "待确认") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (typeof value === "string" && value.includes("待")) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-white text-slate-800";
};

const getInitial = (name: string) => name.slice(0, 1);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const TABLE_HEADER_CLASS = "px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-3 align-middle text-sm text-slate-700";
const EMPLOYEE_PAGE_SIZE = 10;

function ActionIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: ArchiveStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={cn("material-chip gap-1.5 whitespace-nowrap", meta.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClassName)} />
      {meta.label}
    </span>
  );
}

function ArchiveActions({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => toast.info("导入花名册（模拟）")}
        className={cn("material-button-secondary justify-center", compact && "px-3 py-2 text-xs")}
      >
        <Upload className="h-4 w-4" />
        导入花名册
      </button>
      <button
        type="button"
        onClick={() => toast.success("归档核对清单已生成（模拟）")}
        className={cn("material-button-primary justify-center", compact && "px-3 py-2 text-xs")}
      >
        <Download className="h-4 w-4" />
        导出核对清单
      </button>
    </div>
  );
}

function GenderDefaultAvatar({
  employee,
  className,
  showInitial = true,
}: {
  employee: EmployeeArchive;
  className?: string;
  showInitial?: boolean;
}) {
  const isFemale = employee.gender === "女";

  return (
    <div
      aria-label={`${employee.name}默认头像`}
      className={cn(
        "relative isolate shrink-0 overflow-hidden rounded-2xl border border-white/80 shadow-inner",
        isFemale
          ? "bg-[linear-gradient(145deg,#fff7fb_0%,#fce7f3_48%,#dbeafe_100%)]"
          : "bg-[linear-gradient(145deg,#eff6ff_0%,#e0f2fe_48%,#f1f5f9_100%)]",
        className,
      )}
    >
      <div
        className={cn(
          "absolute left-1/2 top-[16%] -translate-x-1/2 rounded-full",
          isFemale
            ? "h-[52%] w-[52%] bg-rose-300"
            : "h-[44%] w-[44%] bg-slate-700",
        )}
      />
      {isFemale ? (
        <>
          <div className="absolute left-[26%] top-[32%] h-[30%] w-[20%] rounded-full bg-rose-300" />
          <div className="absolute right-[26%] top-[32%] h-[30%] w-[20%] rounded-full bg-rose-300" />
        </>
      ) : (
        <div className="absolute left-1/2 top-[14%] h-[18%] w-[42%] -translate-x-1/2 rounded-t-full bg-slate-800" />
      )}
      <div className="absolute left-1/2 top-[28%] h-[34%] w-[34%] -translate-x-1/2 rounded-full bg-[#f4c7b2]" />
      <div className="absolute left-1/2 top-[59%] h-[14%] w-[16%] -translate-x-1/2 rounded-b-lg bg-[#eebca8]" />
      <div
        className={cn(
          "absolute left-1/2 bottom-[-12%] h-[42%] w-[82%] -translate-x-1/2 rounded-t-full",
          isFemale ? "bg-rose-500" : "bg-blue-600",
        )}
      />
      <div className="absolute left-[34%] top-[43%] h-[4%] w-[4%] rounded-full bg-slate-700" />
      <div className="absolute right-[34%] top-[43%] h-[4%] w-[4%] rounded-full bg-slate-700" />
      <div className="absolute left-1/2 top-[51%] h-[2%] w-[12%] -translate-x-1/2 rounded-full bg-rose-400/80" />
      {showInitial ? (
        <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[10px] font-bold text-slate-700 shadow-sm ring-1 ring-slate-200">
          {getInitial(employee.name)}
        </span>
      ) : null}
    </div>
  );
}

function ResumeFieldGrid({ employee, fields }: { employee: EmployeeArchive; fields: FieldItem[] }) {
  return (
    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 2xl:grid-cols-3">
      {fields.map((field) => {
        const tone = getValueTone(employee, field.label, field.value);
        const valueClassName = tone.includes("red")
          ? "text-red-700"
          : tone.includes("amber")
            ? "text-amber-700"
            : "text-slate-900";

        return (
          <div key={field.label} className="min-w-0 border-b border-slate-100 pb-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {field.label}
              </p>
              {field.sensitive ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-300" /> : null}
            </div>
            <p className={cn("mt-1 min-h-5 break-words text-sm font-semibold leading-5", valueClassName)}>
              {field.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function BadgePreview({
  employee,
  template,
  positions,
  avatarDraft,
  isPositionEditing,
  isPositionConfirmed,
  onMovePosition,
  compact = false,
}: {
  employee: EmployeeArchive;
  template: BadgeTemplate;
  positions: BadgeOverlayPositions;
  avatarDraft: BadgeAvatarDraft;
  isPositionEditing: boolean;
  isPositionConfirmed: boolean;
  onMovePosition: (key: BadgeOverlayKey, position: BadgeOverlayPosition) => void;
  compact?: boolean;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const [draggingKey, setDraggingKey] = useState<BadgeOverlayKey | null>(null);
  const [resizingKey, setResizingKey] = useState<BadgeOverlayKey | null>(null);
  const badgeId = getBadgeEmployeeId(employee);
  const departmentEn = departmentEnglish[employee.department] ?? "Office";
  const canEditPosition = isPositionEditing;
  const positionStatus = isPositionEditing ? "拖动调整中" : isPositionConfirmed ? "位置已固定" : "位置待确认";

  const overlayStyle = (key: BadgeOverlayKey) => {
    const position = positions[key];
    return {
      left: `${position.left}%`,
      top: `${position.top}%`,
      width: `${position.width}%`,
      height: `${position.height}%`,
    };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, key: BadgeOverlayKey) => {
    if (!canEditPosition) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = positions[key];
    dragOffsetRef.current = {
      x: event.clientX - rect.left - (position.left / 100) * rect.width,
      y: event.clientY - rect.top - (position.top / 100) * rect.height,
    };
    setDraggingKey(key);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>, key: BadgeOverlayKey) => {
    if (!canEditPosition || draggingKey !== key) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = positions[key];
    const nextLeft = ((event.clientX - rect.left - dragOffsetRef.current.x) / rect.width) * 100;
    const nextTop = ((event.clientY - rect.top - dragOffsetRef.current.y) / rect.height) * 100;
    onMovePosition(key, {
      ...position,
      left: Number(clamp(nextLeft, 0, 100 - position.width).toFixed(1)),
      top: Number(clamp(nextTop, 0, 100 - position.height).toFixed(1)),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingKey) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingKey(null);
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, key: BadgeOverlayKey) => {
    if (!canEditPosition) return;
    const position = positions[key];
    resizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: position.width,
      height: position.height,
    };
    setResizingKey(key);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>, key: BadgeOverlayKey) => {
    if (!canEditPosition || resizingKey !== key) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const position = positions[key];
    const widthDelta = ((event.clientX - resizeStartRef.current.x) / rect.width) * 100;
    const heightDelta = ((event.clientY - resizeStartRef.current.y) / rect.height) * 100;
    const nextWidth = clamp(resizeStartRef.current.width + widthDelta, 8, 100 - position.left);
    const nextHeight = clamp(resizeStartRef.current.height + heightDelta, 8, 100 - position.top);
    onMovePosition(key, {
      ...position,
      width: Number(nextWidth.toFixed(1)),
      height: Number(nextHeight.toFixed(1)),
    });
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingKey) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingKey(null);
  };

  const movableClassName = (key: BadgeOverlayKey) =>
    cn(
      "absolute z-10 touch-none",
      canEditPosition &&
        "cursor-grab rounded-lg ring-2 ring-blue-500/80 ring-offset-2 ring-offset-white/80 transition-shadow",
      (draggingKey === key || resizingKey === key) && "cursor-grabbing bg-blue-500/10 ring-blue-600",
    );

  const editLabel = (label: string) =>
    canEditPosition ? (
      <span className="pointer-events-none absolute left-1 top-1 z-20 rounded-md bg-blue-600 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white shadow-sm">
        {label}
      </span>
    ) : null;

  return (
    <div className={cn("mx-auto w-full", compact ? "max-w-[210px]" : "max-w-[300px]")}>
      <div
        ref={previewRef}
        className="relative aspect-[154/245] w-full overflow-hidden rounded-[28px] shadow-[0_24px_54px_rgba(15,23,42,0.28)] ring-1 ring-slate-200"
        style={{ backgroundColor: template.primary }}
      >
        <img
          src={template.frontImage}
          alt={`${template.name}胸牌模板`}
          className="absolute inset-0 h-full w-full object-fill"
          draggable={false}
        />

        <div
          className={cn(movableClassName("name"), "text-white")}
          style={overlayStyle("name")}
          onPointerDown={(event) => startDrag(event, "name")}
          onPointerMove={(event) => moveDrag(event, "name")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("姓名")}
          <div className="truncate text-[1.18rem] font-bold leading-tight tracking-wide">{employee.name}</div>
        </div>

        <div
          className={cn(movableClassName("departmentCaption"), "text-white/70")}
          style={overlayStyle("departmentCaption")}
          onPointerDown={(event) => startDrag(event, "departmentCaption")}
          onPointerMove={(event) => moveDrag(event, "departmentCaption")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("标签")}
          <div className="truncate text-[10px] font-semibold leading-none">所属部门</div>
        </div>

        <div
          className={cn(movableClassName("department"), "text-white")}
          style={overlayStyle("department")}
          onPointerDown={(event) => startDrag(event, "department")}
          onPointerMove={(event) => moveDrag(event, "department")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("部门")}
          <div className="truncate text-[11px] font-semibold leading-tight">{departmentEn}</div>
        </div>

        <div
          className={cn(movableClassName("title"), "text-white/90")}
          style={overlayStyle("title")}
          onPointerDown={(event) => startDrag(event, "title")}
          onPointerMove={(event) => moveDrag(event, "title")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("职位")}
          <div className="truncate text-[11px] font-semibold leading-tight">{employee.title}</div>
        </div>

        <div
          className={cn(movableClassName("photo"), "flex items-center justify-center overflow-hidden rounded-[18px]")}
          style={overlayStyle("photo")}
          onPointerDown={(event) => startDrag(event, "photo")}
          onPointerMove={(event) => moveDrag(event, "photo")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("头像")}
          {avatarDraft.dataUrl ? (
            <img
              src={avatarDraft.dataUrl}
              alt={`${employee.name}头像`}
              className="absolute left-1/2 top-1/2 object-cover"
              draggable={false}
              style={{
                width: `${avatarDraft.imageWidth}%`,
                height: `${avatarDraft.imageHeight}%`,
                borderRadius: `${avatarDraft.radius}px`,
                transform: `translate(-50%, -50%) translate(${avatarDraft.offsetX}%, ${avatarDraft.offsetY}%) rotate(${avatarDraft.rotate}deg)`,
              }}
            />
          ) : (
            <GenderDefaultAvatar
              employee={employee}
              className="h-full w-full rounded-[18px] border-0 shadow-none"
              showInitial={false}
            />
          )}
          {canEditPosition ? (
            <div
              role="button"
              aria-label="拉伸头像宽高"
              className="absolute bottom-1 right-1 z-30 h-4 w-4 cursor-nwse-resize rounded-sm border border-white bg-blue-600 shadow-sm"
              onPointerDown={(event) => startResize(event, "photo")}
              onPointerMove={(event) => moveResize(event, "photo")}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            >
              <span className="absolute bottom-[3px] right-[3px] h-2 w-2 border-b-2 border-r-2 border-white/90" />
            </div>
          ) : null}
        </div>

        <div
          className={cn(movableClassName("employeeId"), "overflow-hidden")}
          style={overlayStyle("employeeId")}
          onPointerDown={(event) => startDrag(event, "employeeId")}
          onPointerMove={(event) => moveDrag(event, "employeeId")}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {editLabel("编号")}
          <div className="absolute inset-0 bg-white" />
          <div
            className="absolute left-0 top-[7%] text-[0.86rem] font-black leading-none tracking-[0.08em]"
            style={{ color: template.primary }}
          >
            {badgeId}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: template.primary }} />
        {template.name} · {positionStatus} · {template.sourceFile}
      </div>
    </div>
  );
}

function BadgeRangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "%",
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={cn("block min-w-0", disabled && "opacity-45")}>
      <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-700">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-2 h-2 w-full cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
      />
    </label>
  );
}

function BadgeAvatarEditor({
  employee,
  avatarDraft,
  photoPosition,
  onUpload,
  onSaveLocal,
  onRemove,
  onChangeAvatar,
  onChangePhotoPosition,
}: {
  employee: EmployeeArchive;
  avatarDraft: BadgeAvatarDraft;
  photoPosition: BadgeOverlayPosition;
  onUpload: () => void;
  onSaveLocal: () => void;
  onRemove: () => void;
  onChangeAvatar: (patch: Partial<BadgeAvatarDraft>) => void;
  onChangePhotoPosition: (position: BadgeOverlayPosition) => void;
}) {
  const hasAvatar = Boolean(avatarDraft.dataUrl);
  const updatePhotoFrame = (patch: Partial<BadgeOverlayPosition>) => {
    const width = Number(clamp(patch.width ?? photoPosition.width, 8, 100 - photoPosition.left).toFixed(1));
    const height = Number(clamp(patch.height ?? photoPosition.height, 8, 100 - photoPosition.top).toFixed(1));
    onChangePhotoPosition({
      ...photoPosition,
      ...patch,
      width,
      height,
      left: Number(clamp(patch.left ?? photoPosition.left, 0, 100 - width).toFixed(1)),
      top: Number(clamp(patch.top ?? photoPosition.top, 0, 100 - height).toFixed(1)),
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <ImageIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">头像图片</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {hasAvatar ? avatarDraft.fileName ?? "本地头像草稿" : "未上传"}
              </p>
            </div>
          </div>
        </div>
        <span
          className={cn(
            "material-chip",
            !hasAvatar
              ? "bg-red-50 text-red-700"
              : avatarDraft.savedLocal
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700",
          )}
        >
          {!hasAvatar ? "待上传" : avatarDraft.savedLocal ? "本地已保存" : "本地草稿"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onUpload} className="material-button-secondary px-3 py-2 text-xs">
          <Upload className="h-4 w-4" />
          上传
        </button>
        <button
          type="button"
          onClick={onSaveLocal}
          disabled={!hasAvatar}
          className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Save className="h-4 w-4" />
          保存本地
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={!hasAvatar}
          className="material-button-secondary px-3 py-2 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Trash2 className="h-4 w-4" />
          移除
        </button>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[120px_minmax(0,1fr)]">
        <div className="flex min-h-[132px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {hasAvatar ? (
            <div className="relative h-28 w-24 overflow-hidden rounded-2xl bg-white shadow-inner">
              <img
                src={avatarDraft.dataUrl}
                alt={`${employee.name}头像预览`}
                className="absolute left-1/2 top-1/2 object-cover"
                style={{
                  width: `${avatarDraft.imageWidth}%`,
                  height: `${avatarDraft.imageHeight}%`,
                  borderRadius: `${avatarDraft.radius}px`,
                  transform: `translate(-50%, -50%) translate(${avatarDraft.offsetX}%, ${avatarDraft.offsetY}%) rotate(${avatarDraft.rotate}deg)`,
                }}
              />
            </div>
          ) : (
            <GenderDefaultAvatar employee={employee} className="h-28 w-24 rounded-2xl" />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <BadgeRangeControl
            label="图片宽度"
            value={avatarDraft.imageWidth}
            min={60}
            max={220}
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ imageWidth: value })}
          />
          <BadgeRangeControl
            label="图片高度"
            value={avatarDraft.imageHeight}
            min={60}
            max={220}
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ imageHeight: value })}
          />
          <BadgeRangeControl
            label="横向偏移"
            value={avatarDraft.offsetX}
            min={-60}
            max={60}
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ offsetX: value })}
          />
          <BadgeRangeControl
            label="纵向偏移"
            value={avatarDraft.offsetY}
            min={-60}
            max={60}
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ offsetY: value })}
          />
          <BadgeRangeControl
            label="旋转"
            value={avatarDraft.rotate}
            min={-20}
            max={20}
            suffix="deg"
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ rotate: value })}
          />
          <BadgeRangeControl
            label="圆角"
            value={avatarDraft.radius}
            min={0}
            max={28}
            suffix="px"
            disabled={!hasAvatar}
            onChange={(value) => onChangeAvatar({ radius: value })}
          />
          <BadgeRangeControl
            label="头像框宽度"
            value={photoPosition.width}
            min={12}
            max={44}
            onChange={(value) => updatePhotoFrame({ width: value })}
          />
          <BadgeRangeControl
            label="头像框高度"
            value={photoPosition.height}
            min={14}
            max={36}
            onChange={(value) => updatePhotoFrame({ height: value })}
          />
        </div>
      </div>
    </div>
  );
}

export function EmployeeArchivePage() {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<ArchiveStatus | "全部">("全部");
  const [selectedId, setSelectedId] = useState(archiveEmployees[0].id);
  const [badgeTemplateKey, setBadgeTemplateKey] = useState<BadgeTemplateKey>("official");
  const [badgePositions, setBadgePositions] = useState<BadgeLayoutPositions>(() => createBadgeLayoutPositions());
  const [badgePositionConfirmed, setBadgePositionConfirmed] = useState<Record<BadgeTemplateKey, boolean>>(
    () => createBadgePositionConfirmed(),
  );
  const [badgeAvatarDrafts, setBadgeAvatarDrafts] = useState<Record<string, BadgeAvatarDraft>>(
    () => loadBadgeAvatarDrafts(),
  );
  const [isBadgePositionEditing, setIsBadgePositionEditing] = useState(false);
  const [isBadgeEditorOpen, setIsBadgeEditorOpen] = useState(false);
  const [view, setView] = useState<"list" | "detail">("list");
  const [listPage, setListPage] = useState(1);

  const companies = useMemo(
    () => ["全部", ...Array.from(new Set(archiveEmployees.map((employee) => employee.company)))],
    [],
  );

  const filteredEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return archiveEmployees.filter((employee) => {
      const matchesKeyword =
        !keyword ||
        [
          employee.name,
          employee.company,
          employee.department,
          employee.title,
          employee.status,
          employee.workLocation,
          employee.costCenter,
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const matchesCompany = companyFilter === "全部" || employee.company === companyFilter;
      const matchesStatus = statusFilter === "全部" || employee.archiveStatus === statusFilter;
      return matchesKeyword && matchesCompany && matchesStatus;
    });
  }, [companyFilter, search, statusFilter]);

  useEffect(() => {
    setListPage(1);
  }, [companyFilter, search, statusFilter]);

  const selected = archiveEmployees.find((employee) => employee.id === selectedId) ?? archiveEmployees[0];
  const badgeEmployeeId = getBadgeEmployeeId(selected);
  const activeBadgeTemplate = getBadgeTemplate(badgeTemplateKey);
  const activeBadgePositions = badgePositions[badgeTemplateKey];
  const isActiveBadgePositionConfirmed = badgePositionConfirmed[badgeTemplateKey];
  const activeBadgeAvatarDraft = badgeAvatarDrafts[selected.id] ?? createBadgeAvatarDraft();
  const badgeRequirements = useMemo<BadgeRequirement[]>(
    () => {
      const departmentEn = departmentEnglish[selected.department];
      return [
        {
          label: "版式模板",
          value: activeBadgeTemplate.name,
          status: "ready",
          required: true,
          helper: activeBadgeTemplate.sourceFile,
        },
        {
          label: "定位状态",
          value: isActiveBadgePositionConfirmed ? "已固定" : "待确认",
          status: isActiveBadgePositionConfirmed ? "ready" : "warning",
          required: true,
          helper: "点击调整位置后拖动元素，确认后固定",
        },
        {
          label: "姓名",
          value: selected.name || "待补充",
          status: selected.name ? "ready" : "missing",
          required: true,
          helper: "正面主姓名",
        },
        {
          label: "头像",
          value: activeBadgeAvatarDraft.dataUrl
            ? activeBadgeAvatarDraft.fileName ?? "本地头像草稿"
            : "待上传标准证件照",
          status: activeBadgeAvatarDraft.dataUrl
            ? activeBadgeAvatarDraft.savedLocal
              ? "ready"
              : "warning"
            : "missing",
          required: true,
          helper: activeBadgeAvatarDraft.dataUrl
            ? activeBadgeAvatarDraft.savedLocal
              ? "已保存到浏览器本地，后续确认时上传 OSS"
              : "已上传，待保存本地草稿"
            : "建议白底证件照，头像框为右上角",
        },
        {
          label: "部门",
          value: selected.department || "待补充",
          status: selected.department ? "ready" : "missing",
          required: true,
          helper: "正面中文部门",
        },
        {
          label: "部门英文",
          value: departmentEn ?? "Office",
          status: departmentEn ? "ready" : "warning",
          required: false,
          helper: "未配置时使用 Office 兜底",
        },
        {
          label: "职位",
          value: selected.title || "待补充",
          status: selected.title ? "ready" : "missing",
          required: true,
          helper: "正面底部职位",
        },
        {
          label: "员工编号",
          value: badgeEmployeeId,
          status: badgeEmployeeId ? "ready" : "missing",
          required: true,
          helper: "EMPLOYEE ID",
        },
        {
          label: "成品尺寸",
          value: BADGE_PRINT_SIZE,
          status: "ready",
          required: true,
          helper: "来自 154 x 245 图片模板",
        },
        {
          label: "导出设置",
          value: "待接入打印导出 / 出血边距",
          status: "warning",
          required: false,
          helper: "正式打印前建议补齐",
        },
      ];
    },
    [activeBadgeAvatarDraft, activeBadgeTemplate, badgeEmployeeId, isActiveBadgePositionConfirmed, selected],
  );
  const requiredBadgeItems = badgeRequirements.filter((item) => item.required);
  const badgeBlockingItems = requiredBadgeItems.filter((item) => item.status === "missing");
  const badgeWarningItems = badgeRequirements.filter((item) => item.status === "warning");
  const badgeReadyRequiredCount = requiredBadgeItems.filter((item) => item.status === "ready").length;
  const completedDocCount = selected.docs.filter((doc) => doc.status === "done").length;
  const reviewDocCount = selected.docs.filter((doc) => doc.status === "review").length;
  const missingDocCount = selected.docs.filter((doc) => doc.status === "missing").length;
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / EMPLOYEE_PAGE_SIZE));
  const currentPage = Math.min(listPage, totalPages);
  const pagedEmployees = useMemo(
    () =>
      filteredEmployees.slice(
        (currentPage - 1) * EMPLOYEE_PAGE_SIZE,
        currentPage * EMPLOYEE_PAGE_SIZE,
      ),
    [currentPage, filteredEmployees],
  );

  const stats = useMemo(() => {
    const total = archiveEmployees.length;
    const completed = archiveEmployees.filter((employee) => employee.archiveStatus === "complete").length;
    const needsAction = archiveEmployees.filter((employee) => employee.archiveStatus !== "complete").length;
    const missing = archiveEmployees.reduce((sum, employee) => sum + employee.missingFields.length, 0);
    return { total, completed, needsAction, missing };
  }, []);

  const statusFilters: Array<{ key: ArchiveStatus | "全部"; label: string }> = [
    { key: "全部", label: "全部状态" },
    { key: "complete", label: "已完成" },
    { key: "review", label: "待复核" },
    { key: "missing", label: "缺项" },
    { key: "onboarding", label: "入职中" },
  ];

  const openDetail = (employeeId: string) => {
    setSelectedId(employeeId);
    setBadgeTemplateKey("official");
    setIsBadgePositionEditing(false);
    setIsBadgeEditorOpen(false);
    setView("detail");
  };

  const updateBadgePosition = (key: BadgeOverlayKey, position: BadgeOverlayPosition) => {
    setBadgePositions((current) => ({
      ...current,
      [badgeTemplateKey]: {
        ...current[badgeTemplateKey],
        [key]: position,
      },
    }));
    setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: false }));
  };

  const resetBadgePositions = () => {
    const defaultPositions = createBadgeOverlayPositions();
    setBadgePositions((current) => ({
      ...current,
      [badgeTemplateKey]: defaultPositions,
    }));
    setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: false }));
    toast.info(`${activeBadgeTemplate.name}模板位置已重置`);
  };

  const toggleBadgePositionEditing = () => {
    if (isBadgePositionEditing) {
      setIsBadgePositionEditing(false);
      setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: true }));
      toast.success(`${activeBadgeTemplate.name}模板位置已固定`);
      return;
    }
    setIsBadgePositionEditing(true);
    setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: false }));
    toast.info("拖动姓名、头像、部门、职位、编号到设计稿标注位置");
  };

  const closeBadgeEditor = () => {
    setIsBadgePositionEditing(false);
    setIsBadgeEditorOpen(false);
  };

  const updateBadgeAvatarDraft = (patch: Partial<BadgeAvatarDraft>) => {
    setBadgeAvatarDrafts((current) => ({
      ...current,
      [selected.id]: normalizeBadgeAvatarDraft({
        ...(current[selected.id] ?? createBadgeAvatarDraft()),
        ...patch,
        savedLocal: false,
      }),
    }));
  };

  const openBadgeAvatarUpload = () => {
    avatarInputRef.current?.click();
  };

  const handleBadgeAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl) {
        toast.error("头像读取失败");
        return;
      }
      setBadgeAvatarDrafts((current) => ({
        ...current,
        [selected.id]: normalizeBadgeAvatarDraft({
          ...(current[selected.id] ?? createBadgeAvatarDraft()),
          dataUrl,
          fileName: file.name,
          updatedAt: new Date().toISOString(),
          savedLocal: false,
        }),
      }));
      toast.success("头像已载入，可继续编辑后保存本地");
    };
    reader.onerror = () => toast.error("头像读取失败");
    reader.readAsDataURL(file);
  };

  const saveBadgeAvatarDraftLocal = () => {
    if (!activeBadgeAvatarDraft.dataUrl) {
      toast.warning("请先上传头像图片");
      return;
    }
    const nextDrafts = {
      ...badgeAvatarDrafts,
      [selected.id]: {
        ...activeBadgeAvatarDraft,
        updatedAt: new Date().toISOString(),
        savedLocal: true,
      },
    };
    if (!persistBadgeAvatarDrafts(nextDrafts)) {
      toast.error("本地保存失败，图片可能过大");
      return;
    }
    setBadgeAvatarDrafts(nextDrafts);
    toast.success("头像草稿已保存到本地，后续保存时再上传 OSS");
  };

  const handleGenerateBadgePrint = () => {
    if (isBadgePositionEditing) {
      toast.warning("请先确认当前胸牌元素位置");
      return;
    }
    if (!isActiveBadgePositionConfirmed) {
      toast.warning("请先点击确认位置，固定当前胸牌排版");
      return;
    }
    if (badgeBlockingItems.length > 0) {
      toast.warning(`请先补齐：${badgeBlockingItems.map((item) => item.label).join("、")}`);
      return;
    }
    if (activeBadgeAvatarDraft.dataUrl && !activeBadgeAvatarDraft.savedLocal) {
      toast.warning("请先保存头像到本地草稿");
      return;
    }
    toast.success("胸牌打印稿已生成（模拟）");
  };

  const removeBadgeAvatarDraft = () => {
    setBadgeAvatarDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[selected.id];
      if (!persistBadgeAvatarDrafts(nextDrafts)) {
        toast.error("本地草稿更新失败");
        return current;
      }
      return nextDrafts;
    });
    toast.info("头像草稿已移除");
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-3 animate-rd-fade-in">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBadgeAvatarFileChange}
      />
      {view === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "花名册人员", value: stats.total, helper: `${stats.completed} 人已完成` },
              { label: "已完成归档", value: stats.completed, helper: "字段与材料均已核对" },
              { label: "待处理归档", value: stats.needsAction, helper: "缺项 / 复核 / 入职中" },
              { label: "字段缺口", value: stats.missing, helper: "来自 34 列主档案" },
            ].map((item) => (
              <div key={item.label} className="material-card-flat flex min-w-0 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-500">{item.label}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{item.helper}</div>
                </div>
                <div className="shrink-0 text-2xl font-bold tracking-tight text-slate-900">{item.value}</div>
              </div>
            ))}
          </section>

          <section className="flex min-h-0 flex-1">
            <main className="material-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-slate-900">花名册列表</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      共 {filteredEmployees.length} 条记录，点击详情再展开字段与材料。
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative w-full lg:w-72">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="搜索姓名、部门、岗位..."
                        className="material-input pl-11"
                      />
                    </div>
                    <ArchiveActions compact />

                    <div className="flex flex-wrap gap-2">
                      {companies.map((company) => (
                        <button
                          key={company}
                          type="button"
                          onClick={() => setCompanyFilter(company)}
                          className={cn(
                            "cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold transition",
                            companyFilter === company
                              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                          )}
                        >
                          {company}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {statusFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setStatusFilter(filter.key)}
                      className={cn(
                        "cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                        statusFilter === filter.key
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="material-scrollbar min-h-0 flex-1 overflow-auto">
                <table className="w-full min-w-[1120px] table-fixed text-left">
                  <colgroup>
                    <col className="w-[190px]" />
                    <col className="w-[180px]" />
                    <col className="w-[170px]" />
                    <col className="w-[170px]" />
                    <col className="w-[170px]" />
                    <col className="w-[190px]" />
                    <col className="w-[70px]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                    <tr>
                      {["员工", "组织", "岗位", "入职 / 结算", "归档", "缺项", "操作"].map((col) => (
                        <th key={col} className={cn(TABLE_HEADER_CLASS, col === "操作" && "text-right")}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-14 text-center text-sm text-slate-400">
                          暂无匹配的花名册记录
                        </td>
                      </tr>
                    ) : (
                      pagedEmployees.map((employee) => (
                        <tr key={employee.id} className="h-[72px] transition hover:bg-blue-50/25">
                          <td className={TABLE_CELL_CLASS}>
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="material-table-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
                                {getInitial(employee.name)}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">{employee.name}</div>
                                <div className="mt-0.5 truncate text-xs text-slate-400">序号 {employee.rosterNo}</div>
                              </div>
                            </div>
                          </td>
                          <td className={TABLE_CELL_CLASS}>
                            <div className="truncate font-medium text-slate-800">{employee.company}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-400">
                              {employee.workLocation} · {employee.department}
                            </div>
                          </td>
                          <td className={TABLE_CELL_CLASS}>
                            <div className="truncate font-medium text-slate-800">{employee.title}</div>
                            <span className="material-chip mt-1 bg-blue-50 text-blue-700">{employee.status}</span>
                          </td>
                          <td className={TABLE_CELL_CLASS}>
                            <div className="font-medium text-slate-800">{employee.hireDate}</div>
                            <div className="mt-0.5 text-xs text-slate-400">结算 {employee.settlementDate}</div>
                          </td>
                          <td className={TABLE_CELL_CLASS}>
                            <div className="flex items-center gap-3">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    employee.archiveScore >= 95
                                      ? "bg-emerald-500"
                                      : employee.archiveScore >= 80
                                        ? "bg-amber-500"
                                        : "bg-red-500",
                                  )}
                                  style={{ width: `${employee.archiveScore}%` }}
                                />
                              </div>
                              <span className="text-sm font-bold text-slate-900">{employee.archiveScore}%</span>
                            </div>
                            <div className="mt-2">
                              <StatusBadge status={employee.archiveStatus} />
                            </div>
                          </td>
                          <td className={TABLE_CELL_CLASS}>
                            {employee.missingFields.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {employee.missingFields.slice(0, 2).map((field) => (
                                  <span key={field} className="material-chip bg-red-50 text-red-700">
                                    {field}
                                  </span>
                                ))}
                                {employee.missingFields.length > 2 && (
                                  <span className="material-chip bg-slate-100 text-slate-600">
                                    +{employee.missingFields.length - 2}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="material-chip gap-1 bg-emerald-50 text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                无缺项
                              </span>
                            )}
                          </td>
                          <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                            <ActionIconButton onClick={() => openDetail(employee.id)} title="查看详情">
                              <ChevronRight className="h-4 w-4" />
                            </ActionIconButton>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid shrink-0 gap-3 border-t border-slate-100 bg-white/95 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0 text-sm text-slate-500">
                  共 <span className="font-semibold text-slate-800">{filteredEmployees.length}</span> 条记录
                  <span className="mx-2 text-slate-300">/</span>
                  每页 {EMPLOYEE_PAGE_SIZE} 条
                  <span className="mx-2 text-slate-300">/</span>
                  第 {currentPage}/{totalPages} 页
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setListPage(1)}
                    disabled={currentPage === 1}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    首页
                  </button>
                  <button
                    type="button"
                    onClick={() => setListPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    上一页
                  </button>
                  <button
                    type="button"
                    onClick={() => setListPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一页
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setListPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    末页
                  </button>
                </div>
              </div>
            </main>

          </section>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="sticky top-0 z-20 mb-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
            <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
              <button
                type="button"
                onClick={() => setView("list")}
                className="material-button-secondary w-fit px-3 py-2 text-xs"
              >
                <ChevronLeft className="h-4 w-4" />
                返回列表
              </button>

              <div className="flex min-w-0 items-center gap-3">
                <GenderDefaultAvatar employee={selected} className="h-11 w-11 rounded-xl" />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold tracking-tight text-slate-950">{selected.name}</h2>
                    <StatusBadge status={selected.archiveStatus} />
                    <span className="material-chip bg-slate-50 text-slate-600">{badgeEmployeeId}</span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-500">
                    {selected.company} · {selected.workLocation} · {selected.department} · {selected.title}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => toast.info("编辑字段（模拟）")}
                  className="material-button-secondary px-3 py-2 text-xs"
                >
                  <Pencil className="h-4 w-4" />
                  编辑字段
                </button>
                <ArchiveActions compact />
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <main className="min-w-0">
              <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Employee Archive</p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-950">员工档案</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[560px]">
                      {[
                        { label: "入职", value: selected.hireDate },
                        { label: "结算", value: selected.settlementDate },
                        { label: "工龄", value: selected.tenure },
                        { label: "费用", value: selected.costCenter },
                      ].map((item) => (
                        <div key={item.label} className="min-w-0 border-l border-slate-200 pl-3">
                          <p className="text-[11px] font-semibold text-slate-400">{item.label}</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {fieldGroups.map((group) => {
                    const fields = group.getFields(selected);
                    return (
                      <section key={group.key} className="px-5 py-5">
                        <div className="mb-4 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                              <group.Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <h4 className="truncate text-sm font-semibold text-slate-950">{group.title}</h4>
                              <p className="mt-0.5 text-xs text-slate-400">{fields.length} 项</p>
                            </div>
                          </div>
                          <ResumeFieldGrid employee={selected} fields={fields} />
                        </div>
                      </section>
                    );
                  })}

                  <section className="px-5 py-5">
                    <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-200">
                          <FileCheck2 className="h-4 w-4" />
                        </span>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-950">材料记录</h4>
                          <p className="mt-0.5 text-xs text-slate-400">{selected.docs.length} 项</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <span className="material-chip bg-emerald-50 text-emerald-700">已归档 {completedDocCount}</span>
                        <span className="material-chip bg-amber-50 text-amber-700">待复核 {reviewDocCount}</span>
                        <span className="material-chip bg-red-50 text-red-700">待补 {missingDocCount}</span>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="hidden grid-cols-[minmax(0,1.05fr)_minmax(0,1.45fr)_96px_82px] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 md:grid">
                        <span>材料</span>
                        <span>核对说明</span>
                        <span>更新</span>
                        <span className="text-right">状态</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {selected.docs.map((doc) => {
                          const meta = docStatusMeta[doc.status];
                          return (
                            <div
                              key={doc.title}
                              className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1.45fr)_96px_82px] md:items-center md:gap-3"
                            >
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                                  <meta.Icon className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">{doc.title}</p>
                                  <p className="mt-0.5 truncate text-xs text-slate-500">{doc.source}</p>
                                </div>
                              </div>
                              <p className="text-sm leading-5 text-slate-600">{doc.detail}</p>
                              <p className="text-xs text-slate-400">{doc.updatedAt}</p>
                              <div className="md:text-right">
                                <span className={cn("material-chip", meta.className)}>{meta.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="px-5 py-4">
                    <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <IdCard className="h-4 w-4 text-slate-400" />
                          <h4 className="text-sm font-semibold text-slate-950">Excel 字段映射</h4>
                          <span className="material-chip bg-slate-50 text-slate-600">{sheetFields.length} 列</span>
                        </div>
                      </div>
                      <div className="flex max-w-3xl flex-wrap gap-1.5">
                        {sheetFields.map((field) => (
                          <span key={field} className="material-chip bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </main>

            <aside className="space-y-3 xl:sticky xl:top-[88px] xl:self-start">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">归档完成度</p>
                  <span className="text-2xl font-bold text-slate-950">{selected.archiveScore}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${selected.archiveScore}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
                    <p className="text-base font-bold text-slate-950">{selected.docs.length}</p>
                    <p className="text-[11px] font-semibold text-slate-400">材料</p>
                  </div>
                  <div className="rounded-xl bg-red-50 px-2 py-2 text-center">
                    <p className="text-base font-bold text-red-700">{selected.missingFields.length}</p>
                    <p className="text-[11px] font-semibold text-red-400">缺项</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-2 py-2 text-center">
                    <p className="text-base font-bold text-amber-700">{reviewDocCount + badgeWarningItems.length}</p>
                    <p className="text-[11px] font-semibold text-amber-500">复核</p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <p className="text-sm font-semibold text-slate-900">待处理</p>
                  </div>
                  {selected.missingFields.length === 0 && badgeBlockingItems.length === 0 ? (
                    <span className="material-chip bg-emerald-50 text-emerald-700">无阻断</span>
                  ) : (
                    <span className="material-chip bg-red-50 text-red-700">
                      {selected.missingFields.length + badgeBlockingItems.length} 项
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.missingFields.length > 0 ? (
                    selected.missingFields.map((field) => (
                      <span key={field} className="material-chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-100">
                        {field}
                      </span>
                    ))
                  ) : (
                    <span className="material-chip gap-1 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      字段完整
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {selected.alerts.map((alert) => (
                    <p key={alert} className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-800">
                      {alert}
                    </p>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">胸牌</p>
                    <p className="mt-0.5 text-xs text-slate-500">{activeBadgeTemplate.name} · {BADGE_PRINT_SIZE}</p>
                  </div>
                  <span
                    className={cn(
                      "material-chip",
                      badgeBlockingItems.length > 0
                        ? "bg-red-50 text-red-700"
                        : isActiveBadgePositionConfirmed
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700",
                    )}
                  >
                    {badgeBlockingItems.length > 0 ? `待补 ${badgeBlockingItems.length}` : isActiveBadgePositionConfirmed ? "可打印" : "待定位"}
                  </span>
                </div>
                <div className="mt-3">
                  <BadgePreview
                    employee={selected}
                    template={activeBadgeTemplate}
                    positions={activeBadgePositions}
                    avatarDraft={activeBadgeAvatarDraft}
                    isPositionEditing={false}
                    isPositionConfirmed={isActiveBadgePositionConfirmed}
                    onMovePosition={updateBadgePosition}
                    compact
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200">
                  {badgeTemplates.map((template) => {
                    const active = badgeTemplateKey === template.key;
                    return (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => setBadgeTemplateKey(template.key)}
                        className={cn(
                          "flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                          active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:bg-white/70",
                        )}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: template.primary }} />
                        <span className="truncate">{template.name}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setIsBadgeEditorOpen(true)}
                  className="material-button-primary mt-3 w-full justify-center"
                >
                  <CreditCard className="h-4 w-4" />
                  编辑胸牌
                </button>
              </section>
            </aside>
          </div>

          {isBadgeEditorOpen ? (
            <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 p-3 backdrop-blur-sm">
              <section className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                <div className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">胸牌定制</h3>
                      <span className="material-chip bg-slate-50 text-slate-600">{activeBadgeTemplate.name}</span>
                      <span className="material-chip bg-slate-50 text-slate-600">{BADGE_PRINT_SIZE}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{selected.name} · {selected.department} · {selected.title}</p>
                  </div>
                  <ActionIconButton type="button" onClick={closeBadgeEditor} title="关闭胸牌编辑">
                    <XCircle className="h-4 w-4" />
                  </ActionIconButton>
                </div>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
                      {badgeTemplates.map((template) => {
                        const active = badgeTemplateKey === template.key;
                        return (
                          <button
                            key={template.key}
                            type="button"
                            onClick={() => setBadgeTemplateKey(template.key)}
                            className={cn(
                              "flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                              active ? "bg-slate-50 text-slate-900 shadow-sm" : "text-slate-500 hover:bg-slate-50",
                            )}
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: template.primary }} />
                            <span className="truncate">{template.name}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="my-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <button
                        type="button"
                        onClick={toggleBadgePositionEditing}
                        className={cn(
                          "inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition",
                          isBadgePositionEditing
                            ? "bg-blue-600 text-white shadow-sm hover:bg-blue-700"
                            : "border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700",
                        )}
                      >
                        {isBadgePositionEditing ? <CheckCircle2 className="h-4 w-4" /> : <Move className="h-4 w-4" />}
                        {isBadgePositionEditing ? "确认位置" : "调整位置"}
                      </button>
                      <ActionIconButton type="button" onClick={resetBadgePositions} title="重置当前模板坐标">
                        <RotateCcw className="h-4 w-4" />
                      </ActionIconButton>
                    </div>

                    <BadgePreview
                      employee={selected}
                      template={activeBadgeTemplate}
                      positions={activeBadgePositions}
                      avatarDraft={activeBadgeAvatarDraft}
                      isPositionEditing={isBadgePositionEditing}
                      isPositionConfirmed={isActiveBadgePositionConfirmed}
                      onMovePosition={updateBadgePosition}
                    />
                  </aside>

                  <main className="min-h-0 overflow-y-auto p-4">
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <div className="min-w-0 space-y-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          {[
                            {
                              label: "必填完成",
                              value: `${badgeReadyRequiredCount}/${requiredBadgeItems.length}`,
                              helper: "模板、定位、头像与员工信息",
                              tone: "text-slate-900",
                            },
                            {
                              label: "待补",
                              value: badgeBlockingItems.length,
                              helper: badgeBlockingItems.length > 0 ? badgeBlockingItems.map((item) => item.label).join("、") : "无阻断项",
                              tone: badgeBlockingItems.length > 0 ? "text-red-700" : "text-emerald-700",
                            },
                            {
                              label: "需确认",
                              value: badgeWarningItems.length,
                              helper: badgeWarningItems.length > 0 ? badgeWarningItems.map((item) => item.label).join("、") : "无提醒",
                              tone: badgeWarningItems.length > 0 ? "text-amber-700" : "text-slate-600",
                            },
                          ].map((item) => (
                            <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <p className="truncate text-xs font-semibold text-slate-500">{item.label}</p>
                              <div className={cn("mt-0.5 text-lg font-bold tracking-tight", item.tone)}>{item.value}</div>
                              <p className="mt-1 truncate text-xs text-slate-500">{item.helper}</p>
                            </div>
                          ))}
                        </div>

                        <BadgeAvatarEditor
                          employee={selected}
                          avatarDraft={activeBadgeAvatarDraft}
                          photoPosition={activeBadgePositions.photo}
                          onUpload={openBadgeAvatarUpload}
                          onSaveLocal={saveBadgeAvatarDraftLocal}
                          onRemove={removeBadgeAvatarDraft}
                          onChangeAvatar={updateBadgeAvatarDraft}
                          onChangePhotoPosition={(position) => updateBadgePosition("photo", position)}
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">字段来源</p>
                              <p className="mt-0.5 text-xs text-slate-500">从当前员工档案回填到模板。</p>
                            </div>
                            <span className="material-chip bg-white text-slate-600">{BADGE_PRINT_SIZE}</span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {[
                              { label: "模板", value: `${activeBadgeTemplate.name} (${activeBadgeTemplate.sourceFile})` },
                              { label: "姓名", value: selected.name },
                              { label: "部门", value: selected.department },
                              { label: "部门英文", value: departmentEnglish[selected.department] ?? "Office" },
                              { label: "职位", value: selected.title },
                              { label: "员工编号", value: badgeEmployeeId },
                            ].map((item) => (
                              <div key={item.label} className="min-w-0 border-b border-slate-200 pb-2">
                                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{item.label}</p>
                                <p className="mt-1 truncate text-sm font-semibold text-slate-900">{item.value}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200">
                          {badgeRequirements.map((item) => {
                            const meta = badgeRequirementMeta[item.status];
                            const RequirementIcon = meta.Icon;
                            return (
                              <div
                                key={item.label}
                                className="grid gap-2 border-b border-slate-100 bg-white px-3 py-2.5 last:border-b-0 md:grid-cols-[92px_minmax(0,1fr)_76px] md:items-center"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <RequirementIcon className={cn("h-4 w-4 shrink-0", meta.iconClassName)} />
                                  <span className="truncate text-sm font-semibold text-slate-800">{item.label}</span>
                                </div>
                                <div className="min-w-0">
                                  <p className={cn("truncate text-sm font-semibold", item.status === "ready" ? "text-slate-800" : item.status === "warning" ? "text-amber-700" : "text-red-700")}>
                                    {item.value}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-slate-400">{item.helper}</p>
                                </div>
                                <span className={cn("material-chip justify-center", meta.className)}>{meta.label}</span>
                              </div>
                            );
                          })}
                        </div>

                        <button type="button" onClick={handleGenerateBadgePrint} className="material-button-primary w-full justify-center">
                          <Printer className="h-4 w-4" />
                          生成打印稿
                        </button>
                      </div>
                    </div>
                  </main>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
