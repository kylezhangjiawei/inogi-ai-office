import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  CakeSlice,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  IdCard,
  Image as ImageIcon,
  MapPin,
  Loader2,
  Move,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import badgeInternTemplate from "../assets/employee-archive/badge-intern.jpeg";
import badgeLaborTemplate from "../assets/employee-archive/badge-labor.jpeg";
import badgeOfficialTemplate from "../assets/employee-archive/badge-official.jpeg";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./components/ui/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { subscribeDepartmentChanges, useDepartmentDirectory } from "./lib/departmentDirectory";
import { t as translate, useI18n } from "./lib/i18n";
import {
  createEmployeeArchive,
  deleteEmployeeArchive,
  getEmployeeArchiveStats,
  getEmployeeBadgeConfig,
  importEmployeeArchives,
  listEmployeeArchives,
  listEmployeeProbationReminders,
  normalizeEmployeeArchiveRecord,
  regularizeEmployeeArchive,
  saveEmployeeBadgeConfig,
  saveEmployeeArchive,
  uploadEmployeeBadgeAvatar,
  type EmployeeArchiveDocument as DocItem,
  type EmployeeArchiveDocumentStatus as DocStatus,
  type EmployeeArchiveBadgeConfig,
  type EmployeeArchiveRecord as EmployeeArchive,
  type EmployeeArchiveStats,
  type EmployeeArchiveStatus as ArchiveStatus,
  type EmployeeProbationReminder,
} from "./lib/employeeArchiveApi";
import { Textarea } from "./components/ui/textarea";
import { Checkbox } from "./components/ui/checkbox";
import { Slider } from "./components/ui/slider";

type FieldGroupKey = "employment" | "identity" | "contact" | "payroll";
type BadgeTemplateKey = "official" | "intern" | "labor";
type BadgeOverlayKey = "name" | "departmentCaption" | "department" | "title" | "photo" | "employeeId";
type BadgeTextFieldKey = Exclude<BadgeOverlayKey, "photo">;
type BadgeRequirementStatus = "ready" | "warning" | "missing";

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

interface ProbationReminder {
  conversionDate: string;
  reminderDate: string;
  daysUntilConversion: number;
  phase: "upcoming" | "active" | "completed";
}

interface BirthdayReminder {
  month: number;
  day: number;
  monthDay: string;
  isToday: boolean;
}

interface EmployeeArchiveEditDraft extends EmployeeArchive {
  identityNumber: string;
  phoneNumber: string;
  bankAccount: string;
  emergencyPhoneNumber: string;
  socialSecurityNumber: string;
}

interface EmployeeEditField {
  key: keyof EmployeeArchiveEditDraft;
  label: string;
  type?: "text" | "date" | "textarea" | "select";
  required?: boolean;
  sensitive?: boolean;
  fullWidth?: boolean;
  placeholder?: string;
  options?: string[];
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
  fileId?: string;
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
type BadgeTextVisibility = Record<BadgeTextFieldKey, boolean>;
type BadgeTextVisibilityByTemplate = Record<BadgeTemplateKey, BadgeTextVisibility>;

const archiveEmployees: EmployeeArchive[] = [
  {
    id: "EA-001",
    rosterNo: "001",
    company: "壹诺吉",
    hireDate: "2024-03-04",
    regularizationDate: "",
    settlementDate: "2024-03-31",
    tenure: "2年4个月",
    status: "在职",
    workLocation: "上海",
    department: "研发注册部",
    title: "注册工程师",
    employeeCode: "INOGI-001",
    name: "林予安",
    idNoMasked: "3205**********1426",
    birthDate: "1994-08-12",
    birthMonthDay: "08-12",
    zodiac: "狗",
    constellation: "狮子座",
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
      { title: "社保首月", source: "社保号 / 社保首月日期", status: "done", detail: "首月日期与入职日期匹配", updatedAt: "2026-06-20" },
    ],
  },
  {
    id: "EA-002",
    rosterNo: "002",
    company: "益雍君",
    hireDate: "2025-09-15",
    regularizationDate: "",
    settlementDate: "2025-09-30",
    tenure: "9个月",
    status: "在职",
    workLocation: "上海",
    department: "法规质量部",
    title: "质量体系专员",
    employeeCode: "INOGI-002",
    name: "周庭序",
    idNoMasked: "3412**********6173",
    birthDate: "1998-02-09",
    birthMonthDay: "02-09",
    zodiac: "虎",
    constellation: "水瓶座",
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
    alerts: ["工资卡信息缺失影响发薪", "中国银行卡号表未匹配到账号"],
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
    regularizationDate: "",
    settlementDate: "2026-05-31",
    tenure: "1个月",
    status: "试用期",
    workLocation: "苏州",
    department: "生产运营部",
    title: "设备技术员",
    employeeCode: "INOGI-003",
    name: "许洛川",
    idNoMasked: "5101**********3918",
    birthDate: "2000-11-02",
    birthMonthDay: "11-02",
    zodiac: "龙",
    constellation: "天蝎座",
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
    archiveStatus: "complete",
    archiveScore: 100,
    missingFields: [],
    alerts: [],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 年龄", status: "done", detail: "证件字段完整", updatedAt: "2026-06-03" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "review", detail: "学历证扫描件清晰度偏低", updatedAt: "2026-06-05" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "done", detail: "工资卡信息已匹配", updatedAt: "2026-06-05" },
      { title: "社保首月", source: "社保号 / 社保首月日期（选填）", status: "review", detail: "选填字段，暂未维护", updatedAt: "2026-06-25" },
    ],
  },
  {
    id: "EA-004",
    rosterNo: "004",
    company: "益雍君",
    hireDate: "2026-06-24",
    regularizationDate: "",
    settlementDate: "2026-06-30",
    tenure: "待转正",
    status: "待入职归档",
    workLocation: "上海",
    department: "销售市场部",
    title: "商务助理",
    employeeCode: "INOGI-004",
    name: "唐亦禾",
    idNoMasked: "4401**********8820",
    birthDate: "2002-04-22",
    birthMonthDay: "04-22",
    zodiac: "马",
    constellation: "金牛座",
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
    missingFields: ["常住地址", "紧急联系人姓名", "紧急联系人关系", "紧急联系人手机", "银行帐号"],
    alerts: ["新入职资料缺项较多", "紧急联系人信息未留存"],
    docs: [
      { title: "身份证信息", source: "证件号码 / 出生日期 / 民族", status: "done", detail: "证件主字段已录入", updatedAt: "2026-06-24" },
      { title: "学历与专业", source: "学历 / 毕业院校 / 专业", status: "done", detail: "学历字段已录入", updatedAt: "2026-06-24" },
      { title: "银行卡与开户行", source: "银行帐号 / 工资卡开户行全称", status: "missing", detail: "工资卡信息待员工提交", updatedAt: "2026-06-25" },
      { title: "紧急联系人", source: "紧急联系人姓名 / 关系 / 手机", status: "missing", detail: "联系人三项均未填写", updatedAt: "2026-06-25" },
    ],
  },
];

function createEmptyEmployeeArchive(id = "empty-employee"): EmployeeArchive {
  return {
    id,
    rosterNo: "",
    company: "",
    hireDate: "",
    regularizationDate: "",
    settlementDate: "",
    tenure: "",
    status: "待入职",
    workLocation: "",
    department: "",
    title: "",
    employeeCode: "",
    name: "",
    idNoMasked: "",
    birthDate: "",
    birthMonthDay: "",
    zodiac: "",
    constellation: "",
    gender: "",
    age: 0,
    ethnicity: "",
    maritalStatus: "",
    phoneMasked: "",
    bankAccountMasked: "",
    bankBranch: "",
    education: "",
    school: "",
    major: "",
    hometown: "",
    registeredAddress: "",
    currentAddress: "",
    emergencyContact: "",
    emergencyRelation: "",
    emergencyPhoneMasked: "",
    socialSecurityNo: "",
    socialSecurityFirstMonth: "",
    note: "",
    costCenter: "",
    archiveStatus: "onboarding",
    archiveScore: 0,
    missingFields: [],
    alerts: [],
    docs: [],
    badgeConfig: {},
  };
}

const EMPTY_EMPLOYEE_ARCHIVE = createEmptyEmployeeArchive();

// ── 花名册真实导入 / 导出 / 本地持久化 ───────────────────────────────────────────
// 主档案匹配用户提供的「在职员工」sheet；结算日期不参与归档，两个社保字段选填。
// 敏感字段（证件/手机/银行/社保/紧急联系人手机）仅存脱敏值，原文不落库。
const ROSTER_COLUMNS = [
  "序号", "隶属", "入职日期", "司龄", "状态", "工作地", "部门", "职务", "工号",
  "姓名", "证件号码", "出生日期", "出生月日", "生肖", "性别", "年龄", "民族", "婚姻状况", "手机号码",
  "银行帐号", "工资卡开户行全称", "学历", "毕业院校", "专业", "籍贯", "户籍地址", "常住地址", "紧急联系人姓名",
  "紧急联系人关系", "紧急联系人手机", "社保号", "社保首月日期",
];
const OPTIONAL_COLUMNS = new Set(["社保号", "社保首月日期"]);
const REQUIRED_COLUMN_COUNT = ROSTER_COLUMNS.filter((c) => !OPTIONAL_COLUMNS.has(c)).length;
const ROSTER_STORAGE_KEY = "employee-archive-roster";

function maskMiddle(value: string, head: number, tail: number): string {
  const s = (value ?? "").trim();
  if (!s) return "";
  if (s.length <= head + tail) return s.length <= 2 ? s : s[0] + "*".repeat(Math.max(1, s.length - 1));
  return s.slice(0, head) + "*".repeat(Math.max(2, s.length - head - tail)) + s.slice(s.length - tail);
}
const maskId = (v: string) => maskMiddle(v, 3, 4);
const maskPhone = (v: string) => (v.trim().length >= 7 ? v.trim().slice(0, 3) + "****" + v.trim().slice(-4) : v.trim());
const maskBank = (v: string) => (v.trim().length >= 4 ? "**** **** " + v.trim().slice(-4) : v.trim());
const maskSocial = (v: string) => maskMiddle(v, 2, 3);

function normalizeBirthDate(value: string): string {
  const match = value.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }
  return formatLocalDate(date);
}

/**
 * 花名册日期既可能是可读日期，也可能是未设置日期格式的 Excel 序列值。
 * 统一转换为接口接受的 YYYY-MM-DD，避免序列值被当作普通字符串后丢失。
 */
function normalizeRosterDate(value: string): string {
  const source = value.trim();
  if (!source) return "";

  const isoPrefix = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (isoPrefix) return normalizeBirthDate(`${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`);

  const readable = source.match(/^(\d{4})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?$/);
  if (readable) return normalizeBirthDate(`${readable[1]}-${readable[2]}-${readable[3]}`);

  const compact = source.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return normalizeBirthDate(`${compact[1]}-${compact[2]}-${compact[3]}`);

  if (/^\d+(?:\.\d+)?$/.test(source)) {
    const serial = Number(source);
    if (Number.isFinite(serial) && serial >= 1 && serial <= 2_958_465) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
      const year = date.getUTCFullYear();
      if (year >= 1900 && year <= 2200) {
        return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      }
    }
  }

  return "";
}

function getBirthDateFromChineseId(idNumber: string): string {
  const normalized = idNumber.replace(/\s+/g, "").toUpperCase();
  let dateDigits = "";
  if (/^\d{17}[\dX]$/.test(normalized)) {
    dateDigits = normalized.slice(6, 14);
  } else if (/^\d{15}$/.test(normalized)) {
    dateDigits = `19${normalized.slice(6, 12)}`;
  } else {
    return "";
  }

  const year = Number(dateDigits.slice(0, 4));
  const month = Number(dateDigits.slice(4, 6));
  const day = Number(dateDigits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }
  return formatLocalDate(date);
}

function getZodiacFromChineseId(idNumber: string): string {
  const birthDate = getBirthDateFromChineseId(idNumber);
  if (!birthDate) return "";
  const date = parseLocalDate(birthDate);
  if (date) {
    try {
      const yearName = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { year: "numeric" })
        .formatToParts(date)
        .find((part) => String(part.type) === "yearName")?.value;
      const branch = yearName?.slice(-1) ?? "";
      const zodiacByBranch: Record<string, string> = {
        子: "鼠",
        丑: "牛",
        寅: "虎",
        卯: "兔",
        辰: "龙",
        巳: "蛇",
        午: "马",
        未: "羊",
        申: "猴",
        酉: "鸡",
        戌: "狗",
        亥: "猪",
      };
      if (zodiacByBranch[branch]) return zodiacByBranch[branch];
    } catch {
      // 极少数旧浏览器不支持农历日历时，回退到出生年份计算。
    }
  }
  const year = Number(birthDate.slice(0, 4));
  const zodiacAnimals = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
  return zodiacAnimals[((year - 4) % 12 + 12) % 12];
}

function getGenderFromChineseId(idNumber: string): string {
  const normalized = idNumber.replace(/\s+/g, "").toUpperCase();
  const sequence = /^\d{17}[\dX]$/.test(normalized)
    ? normalized.slice(14, 17)
    : /^\d{15}$/.test(normalized)
      ? normalized.slice(12, 15)
      : "";
  if (!sequence) return "";
  return Number(sequence) % 2 === 1 ? "男" : "女";
}

function getAgeFromBirthDate(birthDate: string, referenceDate = new Date()): number {
  const date = parseLocalDate(birthDate);
  if (!date) return 0;
  let age = referenceDate.getFullYear() - date.getFullYear();
  const birthdayPassed =
    referenceDate.getMonth() > date.getMonth() ||
    (referenceDate.getMonth() === date.getMonth() && referenceDate.getDate() >= date.getDate());
  if (!birthdayPassed) age -= 1;
  return Math.max(0, age);
}

function getTenureFromHireDate(hireDate: string, referenceDate = new Date()): string {
  const date = parseLocalDate(hireDate);
  if (!date) return "";
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  if (date > today) return "待入职";
  let years = today.getFullYear() - date.getFullYear();
  let months = today.getMonth() - date.getMonth();
  if (today.getDate() < date.getDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years <= 0 && months <= 0) return "不足1个月";
  return `${years > 0 ? `${years}年` : ""}${months > 0 ? `${months}个月` : ""}`;
}

function translateTenure(value: string): string {
  if (!value) return "";
  const yearsAndMonths = value.match(/^(\d+)年(\d+)个月$/);
  if (yearsAndMonths) {
    return translate("{years}年{months}个月", { years: yearsAndMonths[1], months: yearsAndMonths[2] });
  }
  const years = value.match(/^(\d+)年$/);
  if (years) return translate("{count}年", { count: years[1] });
  const months = value.match(/^(\d+)个月$/);
  if (months) return translate("{count}个月", { count: months[1] });
  return translate(value);
}

function getConstellation(birthDate: string): string {
  const match = birthDate.trim().match(/^(?:\d{4}[-/.])?(\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const boundaries = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
  const signsAfterBoundary = [
    "水瓶座",
    "双鱼座",
    "白羊座",
    "金牛座",
    "双子座",
    "巨蟹座",
    "狮子座",
    "处女座",
    "天秤座",
    "天蝎座",
    "射手座",
    "摩羯座",
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return day < boundaries[month - 1]
    ? signsAfterBoundary[(month + 10) % 12]
    : signsAfterBoundary[month - 1];
}

function getEmployeeConstellation(employee: Pick<EmployeeArchive, "birthDate" | "constellation">): string {
  return getConstellation(employee.birthDate) || employee.constellation;
}

function getEmployeeConstellationDisplay(employee: Pick<EmployeeArchive, "birthDate" | "constellation">): string {
  return getEmployeeConstellation(employee) || "缺少出生日期";
}

function parseLocalDate(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBirthdayMonthDay(value: string): { month: number; day: number; monthDay: string } | null {
  const match = value.trim().match(/^(?:\d{4}[-/.])?(\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const lastDay = month >= 1 && month <= 12 ? new Date(2000, month, 0).getDate() : 0;
  if (day < 1 || day > lastDay) return null;
  return {
    month,
    day,
    monthDay: `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function getEmployeeBirthdayReminder(
  employee: Pick<EmployeeArchive, "birthMonthDay" | "birthDate" | "status">,
  referenceDate = new Date(),
): BirthdayReminder | null {
  if (/(离职|退休|终止|解除)/.test(employee.status.trim())) return null;
  const birthday = [employee.birthMonthDay, employee.birthDate]
    .map(parseBirthdayMonthDay)
    .find((value): value is NonNullable<typeof value> => Boolean(value));
  if (!birthday || birthday.month !== referenceDate.getMonth() + 1) return null;
  return {
    ...birthday,
    isToday: birthday.day === referenceDate.getDate(),
  };
}

function addCalendarMonths(date: Date, months: number): Date {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  const laterUtc = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const earlierUtc = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((laterUtc - earlierUtc) / 86_400_000);
}

function getProbationReminder(employee: EmployeeArchive, referenceDate = new Date()): ProbationReminder | null {
  if (!shouldTrackProbation(employee.status)) return null;
  const hireDate = parseLocalDate(employee.hireDate);
  if (!hireDate) return null;

  const conversionDate = addCalendarMonths(hireDate, 3);
  const reminderDate = addCalendarMonths(conversionDate, -1);
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const daysUntilConversion = differenceInCalendarDays(conversionDate, today);
  const phase = today < reminderDate ? "upcoming" : daysUntilConversion >= 0 ? "active" : "completed";

  return {
    conversionDate: formatLocalDate(conversionDate),
    reminderDate: formatLocalDate(reminderDate),
    daysUntilConversion,
    phase,
  };
}

function shouldTrackProbation(status: string): boolean {
  return !/(已转正|正式员工|离职|退休|终止|解除)/.test(status.trim());
}

function isEmployeeRegularized(employee: Pick<EmployeeArchive, "regularizationDate" | "status">): boolean {
  return Boolean(employee.regularizationDate) || /已转正|正式员工/.test(employee.status.trim());
}

function getExpectedRegularizationDate(employee: Pick<EmployeeArchive, "hireDate">): string {
  const hireDate = parseLocalDate(employee.hireDate);
  return hireDate ? formatLocalDate(addCalendarMonths(hireDate, 3)) : "";
}

function canRegularizeEmployee(
  employee: Pick<EmployeeArchive, "hireDate" | "regularizationDate" | "status">,
  referenceDate = new Date(),
): boolean {
  if (isEmployeeRegularized(employee)) return false;
  if (/待入职|入职中|离职|退休|终止|解除/.test(employee.status.trim())) return false;
  const hireDate = parseLocalDate(employee.hireDate);
  if (!hireDate) return false;
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  return hireDate <= today;
}

function deriveArchiveFromRow(get: (col: string) => string, index: number): EmployeeArchive {
  const source = (c: string) => get(c).trim();
  const hireDate = normalizeRosterDate(source("入职日期"));
  const idBirthDate = getBirthDateFromChineseId(source("证件号码"));
  const birthDate = idBirthDate || normalizeRosterDate(source("出生日期"));
  const raw = (c: string) => {
    if (c === "入职日期") return hireDate;
    if (c === "司龄") return getTenureFromHireDate(hireDate) || source("司龄");
    if (c === "出生日期") return birthDate;
    if (c === "出生月日") return birthDate.slice(5) || source("出生月日");
    if (c === "年龄") return birthDate ? String(getAgeFromBirthDate(birthDate)) : source("年龄");
    if (c === "生肖") return getZodiacFromChineseId(source("证件号码")) || source("生肖");
    if (c === "性别") return getGenderFromChineseId(source("证件号码")) || source("性别");
    return source(c);
  };
  const missingFields = ROSTER_COLUMNS.filter((c) => !OPTIONAL_COLUMNS.has(c) && !raw(c));
  const filled = REQUIRED_COLUMN_COUNT - missingFields.length;
  const archiveScore = Math.round((filled / REQUIRED_COLUMN_COUNT) * 100);
  const statusText = raw("状态");
  const archiveStatus: ArchiveStatus =
    missingFields.length === 0
      ? "complete"
      : /入职|待入职/.test(statusText)
        ? "onboarding"
        : /试用/.test(statusText)
          ? "review"
          : "missing";

  const today = new Date().toISOString().slice(0, 10);
  const docOf = (title: string, source: string, cols: string[]): DocItem => {
    const miss = cols.some((c) => !raw(c));
    return { title, source, status: miss ? "missing" : "done", detail: miss ? "存在缺项，待补录" : "字段完整，已核对", updatedAt: today };
  };
  const docs: DocItem[] = [
    docOf("身份证信息", "证件号码 / 出生日期 / 民族", ["证件号码", "出生日期", "民族", "性别"]),
    docOf("学历与专业", "学历 / 毕业院校 / 专业", ["学历", "毕业院校", "专业"]),
    docOf("银行卡与开户行", "银行帐号 / 工资卡开户行全称", ["银行帐号", "工资卡开户行全称"]),
    ...(raw("社保号") || raw("社保首月日期")
      ? [{
          title: "社保首月",
          source: "社保号 / 社保首月日期（选填）",
          status: raw("社保号") && raw("社保首月日期") ? "done" as const : "review" as const,
          detail: raw("社保号") && raw("社保首月日期") ? "选填字段已维护" : "选填信息仅录入一项，可继续补充",
          updatedAt: today,
        }]
      : []),
    docOf("紧急联系人", "紧急联系人姓名 / 关系 / 手机", ["紧急联系人姓名", "紧急联系人关系", "紧急联系人手机"]),
  ];
  const alerts: string[] = [];
  if (!raw("银行帐号") || !raw("工资卡开户行全称")) alerts.push("工资卡信息缺失影响发薪");
  if (!raw("紧急联系人姓名")) alerts.push("紧急联系人信息未留存");

  return {
    id: `emp-${raw("序号") || index}`,
    rosterNo: raw("序号"),
    company: raw("隶属"),
    hireDate: raw("入职日期"),
    regularizationDate: "",
    settlementDate: "",
    tenure: raw("司龄"),
    status: statusText,
    workLocation: raw("工作地"),
    department: raw("部门"),
    title: raw("职务"),
    employeeCode: raw("工号"),
    name: raw("姓名"),
    idNoMasked: maskId(raw("证件号码")),
    birthDate: raw("出生日期"),
    birthMonthDay: raw("出生月日"),
    zodiac: raw("生肖"),
    constellation: getConstellation(birthDate),
    gender: raw("性别"),
    age: Number(raw("年龄")) || 0,
    ethnicity: raw("民族"),
    maritalStatus: raw("婚姻状况"),
    phoneMasked: maskPhone(raw("手机号码")),
    bankAccountMasked: maskBank(raw("银行帐号")),
    bankBranch: raw("工资卡开户行全称"),
    education: raw("学历"),
    school: raw("毕业院校"),
    major: raw("专业"),
    hometown: raw("籍贯"),
    registeredAddress: raw("户籍地址"),
    currentAddress: raw("常住地址"),
    emergencyContact: raw("紧急联系人姓名"),
    emergencyRelation: raw("紧急联系人关系"),
    emergencyPhoneMasked: maskPhone(raw("紧急联系人手机")),
    socialSecurityNo: maskSocial(raw("社保号")),
    socialSecurityFirstMonth: raw("社保首月日期"),
    note: "",
    costCenter: "",
    archiveStatus,
    archiveScore,
    missingFields,
    alerts,
    docs,
  };
}

interface ParsedRosterWorkbook {
  items: EmployeeArchive[];
  headerFound: boolean;
}

async function parseRosterWorkbook(data: ArrayBuffer): Promise<ParsedRosterWorkbook> {
  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
  const wb = XLSX.read(new Uint8Array(data), { type: "array" });
  const wsName = wb.SheetNames.find((n) => /在职/.test(n)) ?? wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  if (!ws) return { items: [], headerFound: false };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  // 表头行：含「姓名」且含「证件」的那一行（跳过标题/合并行）
  let hdrIdx = rows.findIndex(
    (r) => Array.isArray(r) && r.some((c) => String(c).trim() === "姓名") && r.some((c) => String(c).includes("证件")),
  );
  if (hdrIdx < 0) hdrIdx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c).trim() === "姓名"));
  if (hdrIdx < 0) return { items: [], headerFound: false };
  // Excel 表头可能带换行或业务备注，例如「工号（2跳过，25,38空）」。
  // 映射前移除空白和中英文括号备注，避免有效列被误判为缺失。
  const normalizeHeader = (value: unknown) => String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
  const headers = (rows[hdrIdx] as unknown[]).map(normalizeHeader);
  const headerAliases: Record<string, string[]> = {
    司龄: ["司龄", "工龄"],
  };
  const colIndex = (name: string) => {
    const candidates = (headerAliases[name] ?? [name]).map(normalizeHeader);
    return headers.findIndex((header) => candidates.includes(header));
  };
  const out: EmployeeArchive[] = [];
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;
    const get = (col: string) => {
      const ci = colIndex(col);
      return ci >= 0 ? String(r[ci] ?? "").trim() : "";
    };
    if (!get("姓名") && !get("序号")) continue; // 跳过空行/尾部合计行
    out.push(deriveArchiveFromRow(get, i));
  }
  return { items: out, headerFound: true };
}

async function exportEmployeeRoster(employees: EmployeeArchive[]): Promise<void> {
  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");
  const rows: Array<Record<string, string | number>> = employees.map((employee) => ({
    序号: employee.rosterNo,
    隶属: employee.company,
    入职日期: employee.hireDate,
    司龄: employee.tenure,
    状态: employee.status,
    工作地: employee.workLocation,
    部门: employee.department,
    职务: employee.title,
    工号: employee.employeeCode,
    姓名: employee.name,
    证件号码: employee.idNoMasked,
    出生日期: employee.birthDate,
    出生月日: employee.birthMonthDay,
    生肖: employee.zodiac,
    性别: employee.gender,
    年龄: employee.age,
    民族: employee.ethnicity,
    婚姻状况: employee.maritalStatus,
    手机号码: employee.phoneMasked,
    银行帐号: employee.bankAccountMasked,
    工资卡开户行全称: employee.bankBranch,
    学历: employee.education,
    毕业院校: employee.school,
    专业: employee.major,
    籍贯: employee.hometown,
    户籍地址: employee.registeredAddress,
    常住地址: employee.currentAddress,
    紧急联系人姓名: employee.emergencyContact,
    紧急联系人关系: employee.emergencyRelation,
    紧急联系人手机: employee.emergencyPhoneMasked,
    社保号: employee.socialSecurityNo,
    社保首月日期: employee.socialSecurityFirstMonth,
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...ROSTER_COLUMNS] });
  ws["!cols"] = ROSTER_COLUMNS.map((column) => ({
    wch: ["户籍地址", "常住地址", "工资卡开户行全称"].includes(column)
      ? 24
      : ["证件号码", "银行帐号", "紧急联系人手机"].includes(column)
        ? 20
        : Math.max(10, column.length * 2 + 2),
  }));
  if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "在职员工");
  XLSX.writeFile(wb, `员工人员名单_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function loadStoredEmployees(): EmployeeArchive[] | null {
  try {
    const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((value) => {
      const employee = normalizeEmployeeArchiveRecord(value);
      const tenure = getTenureFromHireDate(employee.hireDate) || employee.tenure;
      const missingFields = Array.from(new Set(employee.missingFields
        .filter((field) => field !== "结算日期")
        .map((field) => field === "工龄" ? "司龄" : field)))
        .filter((field) => field !== "司龄" || !tenure);
      const archiveStatus: ArchiveStatus = missingFields.length === 0
        ? "complete"
        : /入职|待入职/.test(employee.status)
          ? "onboarding"
          : /试用/.test(employee.status)
            ? "review"
            : "missing";
      return {
        ...employee,
        tenure,
        constellation: getEmployeeConstellation(employee),
        missingFields,
        archiveScore: Math.max(0, Math.min(100, Math.round(((REQUIRED_COLUMN_COUNT - missingFields.length) / REQUIRED_COLUMN_COUNT) * 100))),
        archiveStatus,
        alerts: employee.alerts
          .filter((alert) => !alert.startsWith("试用期归档需在"))
          .map((alert) => (alert === "工资卡信息缺失影响结算" ? "工资卡信息缺失影响发薪" : alert)),
        docs: employee.docs.map((doc) => ({
          ...doc,
          detail: doc.detail.replaceAll("结算日期", "入职日期"),
        })),
      };
    });
  } catch {
    return null;
  }
}
function saveStoredEmployees(list: EmployeeArchive[]): void {
  try {
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 忽略存储配额/隐私模式异常 */
  }
}

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
    description: "对应在职员工表 A-J 列",
    Icon: Building2,
    getFields: (employee) => [
      { label: "序号", value: employee.rosterNo },
      { label: "隶属", value: employee.company },
      { label: "入职日期", value: employee.hireDate },
      { label: "司龄", value: translateTenure(employee.tenure) },
      { label: "状态", value: employee.status },
      { label: "工作地", value: employee.workLocation },
      { label: "部门", value: employee.department },
      { label: "职务", value: employee.title },
      { label: "工号", value: employee.employeeCode },
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
      { label: "星座", value: getEmployeeConstellationDisplay(employee) },
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
    ],
  },
];

const employeeEditGroups: Array<{
  key: FieldGroupKey;
  title: string;
  description: string;
  Icon: typeof Users;
  fields: EmployeeEditField[];
}> = [
  {
    key: "employment",
    title: "组织与入职",
    description: "员工编号、所属组织和任职信息",
    Icon: Building2,
    fields: [
      { key: "rosterNo", label: "序号", required: true },
      { key: "company", label: "隶属", required: true },
      { key: "hireDate", label: "入职日期", type: "date", required: true },
      { key: "status", label: "状态", required: true, placeholder: "例如：在职、试用期" },
      { key: "workLocation", label: "工作地", required: true },
      { key: "department", label: "部门", required: true },
      { key: "title", label: "职务", required: true },
      { key: "employeeCode", label: "工号", required: true },
      { key: "costCenter", label: "费用归属（内部选填）" },
    ],
  },
  {
    key: "identity",
    title: "身份与学历",
    description: "身份证修改后会自动刷新出生信息、生肖、性别和年龄",
    Icon: IdCard,
    fields: [
      { key: "name", label: "姓名", required: true },
      { key: "identityNumber", label: "新身份证号码", sensitive: true, required: true, placeholder: "不修改请留空" },
      { key: "birthDate", label: "出生日期（无身份证时填写）", type: "date" },
      { key: "gender", label: "性别（无身份证时填写）", type: "select", options: ["", "男", "女"] },
      { key: "ethnicity", label: "民族", required: true },
      { key: "maritalStatus", label: "婚姻状况", type: "select", required: true, options: ["", "未婚", "已婚", "离异", "丧偶"] },
      { key: "education", label: "学历", required: true },
      { key: "school", label: "毕业院校", required: true },
      { key: "major", label: "专业", required: true },
    ],
  },
  {
    key: "contact",
    title: "地址与联系人",
    description: "新号码保存后仅保留脱敏结果",
    Icon: MapPin,
    fields: [
      { key: "phoneNumber", label: "新手机号码", sensitive: true, required: true, placeholder: "不修改请留空" },
      { key: "hometown", label: "籍贯", required: true },
      { key: "registeredAddress", label: "户籍地址", type: "textarea", required: true, fullWidth: true },
      { key: "currentAddress", label: "常住地址", type: "textarea", required: true, fullWidth: true },
      { key: "emergencyContact", label: "紧急联系人姓名", required: true },
      { key: "emergencyRelation", label: "紧急联系人关系", required: true },
      { key: "emergencyPhoneNumber", label: "紧急联系人新手机", sensitive: true, required: true, placeholder: "不修改请留空" },
      { key: "note", label: "备注（内部选填）", type: "textarea", fullWidth: true },
    ],
  },
  {
    key: "payroll",
    title: "银行与社保",
    description: "敏感号码只用于本次更新并在服务端即时脱敏",
    Icon: Banknote,
    fields: [
      { key: "bankAccount", label: "新银行帐号", sensitive: true, required: true, placeholder: "不修改请留空" },
      { key: "bankBranch", label: "工资卡开户行全称", required: true, fullWidth: true },
      { key: "socialSecurityNumber", label: "新社保号（选填）", sensitive: true, placeholder: "不修改请留空" },
      { key: "socialSecurityFirstMonth", label: "社保首月日期（选填）", placeholder: "YYYY-MM" },
    ],
  },
];

const sheetFields = [...ROSTER_COLUMNS];

const BADGE_PRINT_SIZE = "154 x 245";
const BADGE_EXPORT_WIDTH = 642;
const BADGE_EXPORT_HEIGHT = 1020;
const BADGE_AVATAR_STORAGE_KEY = "employee-archive-badge-avatar-drafts";
const BADGE_TEXT_VISIBILITY_STORAGE_KEY = "employee-archive-badge-text-visibility";

const badgeTextFieldOptions: Array<{ key: BadgeTextFieldKey; label: string }> = [
  { key: "name", label: "姓名" },
  { key: "departmentCaption", label: "所属部门标签" },
  { key: "department", label: "部门英文" },
  { key: "title", label: "职位" },
  { key: "employeeId", label: "员工编号" },
];

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

const createBadgeTextVisibility = (): BadgeTextVisibility => ({
  name: true,
  departmentCaption: true,
  department: true,
  title: true,
  employeeId: true,
});

const createBadgeTextVisibilityByTemplate = (): BadgeTextVisibilityByTemplate => ({
  official: createBadgeTextVisibility(),
  intern: createBadgeTextVisibility(),
  labor: createBadgeTextVisibility(),
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

const loadBadgeTextVisibility = (): BadgeTextVisibilityByTemplate => {
  const defaults = createBadgeTextVisibilityByTemplate();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(BADGE_TEXT_VISIBILITY_STORAGE_KEY);
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as Partial<Record<BadgeTemplateKey, Partial<BadgeTextVisibility>>>;
    return {
      official: { ...defaults.official, ...stored.official },
      intern: { ...defaults.intern, ...stored.intern },
      labor: { ...defaults.labor, ...stored.labor },
    };
  } catch {
    return defaults;
  }
};

const persistBadgeTextVisibility = (visibility: BadgeTextVisibilityByTemplate) => {
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(BADGE_TEXT_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
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
  研发注册部: "R&D and Registration",
  研发生产部: "R&D and Production",
  法规质量部: "Regulatory and Quality",
  生产运营部: "Production Operations",
  销售市场部: "Sales and Marketing",
  人事行政部: "HR and Administration",
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

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("胸牌图片资源加载失败"));
    image.src = src;
  });
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawDefaultBadgeAvatar(
  context: CanvasRenderingContext2D,
  employee: EmployeeArchive,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const isFemale = employee.gender === "女";
  context.fillStyle = isFemale ? "#fff1f2" : "#eff6ff";
  context.fillRect(x, y, width, height);

  const centerX = x + width / 2;
  context.fillStyle = isFemale ? "#fda4af" : "#334155";
  context.beginPath();
  context.ellipse(centerX, y + height * 0.38, width * 0.26, height * 0.3, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f4c7b2";
  context.beginPath();
  context.ellipse(centerX, y + height * 0.45, width * 0.18, height * 0.18, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = isFemale ? "#e11d48" : "#2563eb";
  context.beginPath();
  context.ellipse(centerX, y + height * 0.94, width * 0.42, height * 0.3, 0, Math.PI, Math.PI * 2);
  context.fill();

  context.fillStyle = "#334155";
  for (const eyeX of [centerX - width * 0.07, centerX + width * 0.07]) {
    context.beginPath();
    context.arc(eyeX, y + height * 0.44, Math.max(2, width * 0.012), 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = "#fb7185";
  context.lineWidth = Math.max(2, width * 0.012);
  context.beginPath();
  context.moveTo(centerX - width * 0.05, y + height * 0.53);
  context.lineTo(centerX + width * 0.05, y + height * 0.53);
  context.stroke();
}

function drawBadgeText(
  context: CanvasRenderingContext2D,
  text: string,
  position: BadgeOverlayPosition,
  options: { color: string; fontSize: number; minFontSize: number; weight: number },
) {
  const x = (position.left / 100) * BADGE_EXPORT_WIDTH;
  const y = (position.top / 100) * BADGE_EXPORT_HEIGHT;
  const width = (position.width / 100) * BADGE_EXPORT_WIDTH;
  const height = (position.height / 100) * BADGE_EXPORT_HEIGHT;
  let fontSize = options.fontSize;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = options.color;
  context.textBaseline = "top";
  while (fontSize > options.minFontSize) {
    context.font = `${options.weight} ${fontSize}px "PingFang SC", "Microsoft YaHei", Arial, sans-serif`;
    if (context.measureText(text).width <= width) break;
    fontSize -= 1;
  }
  context.fillText(text, x, y);
  context.restore();
}

async function renderBadgePng({
  employee,
  template,
  positions,
  avatarDraft,
  textVisibility,
}: {
  employee: EmployeeArchive;
  template: BadgeTemplate;
  positions: BadgeOverlayPositions;
  avatarDraft: BadgeAvatarDraft;
  textVisibility: BadgeTextVisibility;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_EXPORT_WIDTH;
  canvas.height = BADGE_EXPORT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法创建胸牌图片");

  const templateImage = await loadCanvasImage(template.frontImage);
  context.fillStyle = template.primary;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

  const photo = positions.photo;
  const photoX = (photo.left / 100) * canvas.width;
  const photoY = (photo.top / 100) * canvas.height;
  const photoWidth = (photo.width / 100) * canvas.width;
  const photoHeight = (photo.height / 100) * canvas.height;
  const frameRadius = (18 / 300) * canvas.width;
  context.save();
  roundedRectPath(context, photoX, photoY, photoWidth, photoHeight, frameRadius);
  context.clip();

  if (avatarDraft.dataUrl) {
    const avatarImage = await loadCanvasImage(avatarDraft.dataUrl);
    const imageWidth = photoWidth * (avatarDraft.imageWidth / 100);
    const imageHeight = photoHeight * (avatarDraft.imageHeight / 100);
    const centerX = photoX + photoWidth / 2 + imageWidth * (avatarDraft.offsetX / 100);
    const centerY = photoY + photoHeight / 2 + imageHeight * (avatarDraft.offsetY / 100);
    context.save();
    context.translate(centerX, centerY);
    context.rotate((avatarDraft.rotate * Math.PI) / 180);
    roundedRectPath(
      context,
      -imageWidth / 2,
      -imageHeight / 2,
      imageWidth,
      imageHeight,
      (avatarDraft.radius / 300) * canvas.width,
    );
    context.clip();
    drawCoverImage(context, avatarImage, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
    context.restore();
  } else {
    drawDefaultBadgeAvatar(context, employee, photoX, photoY, photoWidth, photoHeight);
  }
  context.restore();

  const departmentEn = departmentEnglish[employee.department] ?? "Office";
  if (textVisibility.name) {
    drawBadgeText(context, employee.name, positions.name, { color: "#ffffff", fontSize: 40, minFontSize: 24, weight: 700 });
  }
  if (textVisibility.departmentCaption) {
    drawBadgeText(context, "所属部门", positions.departmentCaption, { color: "rgba(255,255,255,0.72)", fontSize: 21, minFontSize: 14, weight: 600 });
  }
  if (textVisibility.department) {
    drawBadgeText(context, departmentEn, positions.department, { color: "#ffffff", fontSize: 24, minFontSize: 14, weight: 600 });
  }
  if (textVisibility.title) {
    drawBadgeText(context, employee.title, positions.title, { color: "rgba(255,255,255,0.92)", fontSize: 24, minFontSize: 14, weight: 600 });
  }
  if (textVisibility.employeeId) {
    const idPosition = positions.employeeId;
    const idX = (idPosition.left / 100) * canvas.width;
    const idY = (idPosition.top / 100) * canvas.height;
    const idWidth = (idPosition.width / 100) * canvas.width;
    const idHeight = (idPosition.height / 100) * canvas.height;
    context.fillStyle = "#ffffff";
    context.fillRect(idX, idY, idWidth, idHeight);
    drawBadgeText(context, getBadgeEmployeeId(employee), idPosition, { color: template.primary, fontSize: 29, minFontSize: 18, weight: 900 });
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("胸牌图片生成失败");
  return blob;
}

function downloadBadgeBlob(blob: Blob, employee: EmployeeArchive, template: BadgeTemplate) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = `${employee.name}-${template.name}`.replace(/[\\/:*?"<>|]/g, "_");
  link.href = objectUrl;
  link.download = `胸牌-${safeName}-${BADGE_EXPORT_WIDTH}x${BADGE_EXPORT_HEIGHT}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

const TABLE_HEADER_CLASS = "px-5 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap";
const TABLE_CELL_CLASS = "px-5 py-3 align-middle text-sm text-slate-700";
const EMPLOYEE_PAGE_SIZE = 10;
const EMPLOYEE_ACTION_COLUMN_WIDTH = 250;
type EmployeeListColumnKey = "employee" | "employeeCode" | "constellation" | "organization" | "position" | "employment" | "archive" | "missing";
const EMPLOYEE_LIST_COLUMN_STORAGE_KEY = "employee-archive-list-columns-v1";
const EMPLOYEE_LIST_COLUMNS: Array<{ key: EmployeeListColumnKey; label: string; width: number }> = [
  { key: "employee", label: "员工", width: 190 },
  { key: "employeeCode", label: "工号", width: 140 },
  { key: "constellation", label: "生日 / 星座", width: 200 },
  { key: "organization", label: "组织", width: 180 },
  { key: "position", label: "岗位", width: 170 },
  { key: "employment", label: "入职 / 转正", width: 190 },
  { key: "archive", label: "归档", width: 170 },
  { key: "missing", label: "缺项", width: 190 },
];

function loadEmployeeListColumnVisibility(): Record<EmployeeListColumnKey, boolean> {
  const defaults = Object.fromEntries(EMPLOYEE_LIST_COLUMNS.map((column) => [column.key, true])) as Record<
    EmployeeListColumnKey,
    boolean
  >;
  try {
    const stored = JSON.parse(localStorage.getItem(EMPLOYEE_LIST_COLUMN_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    for (const column of EMPLOYEE_LIST_COLUMNS) {
      if (typeof stored[column.key] === "boolean") defaults[column.key] = stored[column.key] as boolean;
    }
  } catch {
    // 无效的旧配置直接回退到默认列。
  }
  return Object.values(defaults).some(Boolean)
    ? defaults
    : Object.fromEntries(EMPLOYEE_LIST_COLUMNS.map((column) => [column.key, true])) as Record<EmployeeListColumnKey, boolean>;
}

function persistEmployeeListColumnVisibility(visibility: Record<EmployeeListColumnKey, boolean>) {
  try {
    localStorage.setItem(EMPLOYEE_LIST_COLUMN_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // 隐私模式或存储空间不足时仍允许本次会话继续使用。
  }
}

function ActionIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className={cn(
        "size-9 shrink-0 rounded-xl border-slate-200 bg-white text-slate-600 shadow-sm hover:border-primary/25 hover:bg-accent hover:text-primary-hover",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
}

function StatusBadge({ status }: { status: ArchiveStatus }) {
  const meta = statusMeta[status] ?? statusMeta.missing;
  return (
    <span className={cn("material-chip gap-1.5 whitespace-nowrap", meta.className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClassName)} />
      {translate(meta.label)}
    </span>
  );
}

function ArchiveActions({
  compact = false,
  onCreate,
  onImport,
  onExport,
}: {
  compact?: boolean;
  onCreate: () => void;
  onImport: () => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        onClick={onCreate}
        className={cn("hz-primary-action", compact && "h-8 px-3 text-xs")}
      >
        <Plus aria-hidden="true" />
        {translate("新增人员")}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onImport}
        className={cn(compact && "h-8 px-3 text-xs")}
      >
        <Upload aria-hidden="true" />
        {translate("导入花名册")}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onExport}
        className={cn(compact && "h-8 px-3 text-xs")}
      >
        <Download aria-hidden="true" />
        {translate("导出人员名单")}
      </Button>
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
      aria-label={translate("{name}默认头像", { name: employee.name })}
      className={cn(
        "relative isolate shrink-0 overflow-hidden rounded-2xl border border-white/80 shadow-inner",
        isFemale ? "bg-rose-50" : "bg-blue-50",
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
              <p className="truncate text-[11px] font-semibold text-muted-foreground">
                {translate(field.label)}
              </p>
              {field.sensitive ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
            </div>
            <p className={cn("mt-1 min-h-5 break-words text-sm font-semibold leading-5", valueClassName)}>
              {typeof field.value === "string" ? translate(field.value) : field.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function EmployeeArchiveEditor({
  draft,
  mode,
  saving,
  error,
  departmentOptions,
  onChange,
  onDocumentsChange,
  onCancel,
  onSave,
}: {
  draft: EmployeeArchiveEditDraft;
  mode: "create" | "edit";
  saving: boolean;
  error: string;
  departmentOptions: string[];
  onChange: (key: keyof EmployeeArchiveEditDraft, value: string) => void;
  onDocumentsChange: (documents: DocItem[]) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [pendingDocumentIndex, setPendingDocumentIndex] = useState<number | null>(null);
  const currentSensitiveValue = (key: keyof EmployeeArchiveEditDraft) => {
    if (key === "identityNumber") return draft.idNoMasked;
    if (key === "phoneNumber") return draft.phoneMasked;
    if (key === "bankAccount") return draft.bankAccountMasked;
    if (key === "emergencyPhoneNumber") return draft.emergencyPhoneMasked;
    if (key === "socialSecurityNumber") return draft.socialSecurityNo;
    return "";
  };
  const sensitiveStoredKey = (key: keyof EmployeeArchiveEditDraft): keyof EmployeeArchiveEditDraft | null => {
    if (key === "identityNumber") return "idNoMasked";
    if (key === "phoneNumber") return "phoneMasked";
    if (key === "bankAccount") return "bankAccountMasked";
    if (key === "emergencyPhoneNumber") return "emergencyPhoneMasked";
    if (key === "socialSecurityNumber") return "socialSecurityNo";
    return null;
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent className="horizon-portal flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <form
        className="flex min-h-0 w-full flex-col overflow-hidden"
        aria-describedby={error ? "employee-archive-editor-error" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-4 pr-14 sm:px-6">
          <div className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
                <Pencil className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-balance text-lg font-semibold text-slate-950">
                  {translate(mode === "create" ? "新增人员" : "编辑人员信息")}
                </DialogTitle>
                <DialogDescription className="mt-0.5 truncate text-pretty text-xs text-slate-500">
                  {mode === "create"
                    ? translate("建立人员主档，保存后同步到服务端")
                    : translate("{name} · {number}，保存后同步更新服务端档案", { name: draft.name, number: draft.rosterNo })}
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="mb-5 flex flex-col gap-2 rounded-2xl border border-blue-100 bg-[#f7f9ff] px-4 py-3 text-sm text-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{translate("必填规则已按当前花名册确认")}</p>
              <p className="mt-0.5 text-pretty text-xs leading-5 text-slate-600">
                {translate("红色 * 为归档必备；结算日期不归档，社保号、社保首月日期为选填。司龄、出生月日、生肖、星座、年龄由系统自动计算。")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {[draft.tenure ? translateTenure(draft.tenure) : translate("司龄"), draft.birthMonthDay || translate("出生月日"), translate(draft.zodiac || "生肖"), translate(getEmployeeConstellationDisplay(draft)), draft.age ? translate("{age}岁", { age: draft.age }) : translate("年龄")].map((value) => (
                <span key={value} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-blue-100">
                  {value}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            {employeeEditGroups.map((group) => (
              <section key={group.key} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <group.Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">{translate(group.title)}</h3>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{translate(group.description)}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.fields.map((field) => {
                    const value = String(draft[field.key] ?? "");
                    const currentValue = field.sensitive ? currentSensitiveValue(field.key) : "";
                    const hasCurrentSensitiveValue = Boolean(
                      currentValue && !/^(待补充|待确认|未填写|缺失|-|—)$/.test(currentValue.trim()),
                    );
                    const requiredInput = Boolean(field.required && (!field.sensitive || !hasCurrentSensitiveValue));
                    const commonClassName = cn(
                      "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:bg-slate-50 disabled:text-slate-400",
                      field.sensitive && "font-mono",
                    );
                    return (
                      <label key={String(field.key)} className={cn("min-w-0", field.fullWidth && "md:col-span-2 xl:col-span-3")}>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                          {translate(field.label)}
                          {field.required ? <span className="text-red-500">*</span> : null}
                          {field.sensitive ? <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                        </span>
                        {field.key === "department" ? (
                          <Select
                            value={value || undefined}
                            onValueChange={(next) => onChange(field.key, next)}
                            disabled={saving}
                            name={String(field.key)}
                            required={requiredInput}
                          >
                            <SelectTrigger className={cn(commonClassName, "h-auto data-[size=default]:h-auto")}>
                              <SelectValue placeholder={translate("请选择")} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-200">
                              {Array.from(new Set([...departmentOptions, ...(value ? [value] : [])])).map((option) => (
                                <SelectItem key={option} value={option}>
                                  {translate(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "textarea" ? (
                          <Textarea
                            rows={3}
                            value={value}
                            required={requiredInput}
                            disabled={saving}
                            placeholder={field.placeholder ? translate(field.placeholder) : undefined}
                            onChange={(event) => onChange(field.key, event.target.value)}
                            className={cn(commonClassName, "resize-y")}
                          />
                        ) : field.type === "select" ? (
                          // Radix Select 禁止空字符串 value，所以「请选择」不作为选项存在，
                          // 改用 placeholder：未选时 value 为 undefined，Root 渲染的隐藏原生
                          // select 也为空，required 校验才能照常拦住提交。
                          <Select
                            value={value || undefined}
                            onValueChange={(next) => onChange(field.key, next)}
                            disabled={saving}
                            name={String(field.key)}
                            required={requiredInput}
                          >
                            <SelectTrigger
                              className={cn(commonClassName, "h-auto data-[size=default]:h-auto")}
                            >
                              <SelectValue placeholder={translate("请选择")} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-200">
                              {field.options?.filter(Boolean).map((option) => (
                                <SelectItem key={option} value={option}>
                                  {translate(option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={field.type ?? "text"}
                            value={value}
                            required={requiredInput}
                            disabled={saving}
                            autoComplete="off"
                            placeholder={field.placeholder ? translate(field.placeholder) : undefined}
                            onChange={(event) => onChange(field.key, event.target.value)}
                            className={commonClassName}
                          />
                        )}
                        {field.sensitive && currentValue ? (
                          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate">{translate("当前：{value}；留空则不修改", { value: currentValue })}</span>
                            <Button variant="unstyled"
                              type="button"
                              className="shrink-0 font-semibold text-red-500 hover:text-red-700"
                              onClick={() => {
                                const storedKey = sensitiveStoredKey(field.key);
                                if (storedKey) onChange(storedKey, "");
                                onChange(field.key, "");
                              }}
                            >
                              {translate("清除当前")}
                            </Button>
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <FileCheck2 className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">{translate("材料记录")}</h3>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{translate("维护材料名称、核对状态、说明和更新时间")}</p>
                  </div>
                </div>
                <Button variant="unstyled"
                  type="button"
                  disabled={saving}
                  onClick={() => onDocumentsChange([
                    ...draft.docs,
                    { title: "", source: "", status: "review", detail: "", updatedAt: formatLocalDate(new Date()) },
                  ])}
                  className="material-button-secondary px-3 py-2 text-xs disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {translate("添加材料")}
                </Button>
              </div>

              {draft.docs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-7 text-center text-sm text-muted-foreground">
                  {translate("暂无材料记录，可点击“添加材料”补充")}
                </div>
              ) : (
                <div className="space-y-3">
                  {draft.docs.map((document, index) => {
                    const updateDocument = (patch: Partial<DocItem>) => {
                      onDocumentsChange(draft.docs.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
                    };
                    return (
                      <div key={`${index}-${document.title}`} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.2fr_130px_140px_auto]">
                          <label className="min-w-0 text-xs font-semibold text-slate-600">
                            {translate("材料名称")}
                            <Input
                              value={document.title}
                              required
                              disabled={saving}
                              onChange={(event) => updateDocument({ title: event.target.value })}
                              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                            />
                          </label>
                          <label className="min-w-0 text-xs font-semibold text-slate-600">
                            {translate("字段来源")}
                            <Input
                              value={document.source}
                              disabled={saving}
                              onChange={(event) => updateDocument({ source: event.target.value })}
                              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                            />
                          </label>
                          <label className="min-w-0 text-xs font-semibold text-slate-600">
                            {translate("状态")}
                            <Select
                              value={document.status}
                              disabled={saving}
                              onValueChange={(next) => updateDocument({ status: next as DocStatus })}
                            >
                              <SelectTrigger className="mt-1.5 h-auto w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:border-primary data-[size=default]:h-auto">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-slate-200">
                                <SelectItem value="done">{translate("已归档")}</SelectItem>
                                <SelectItem value="review">{translate("待复核")}</SelectItem>
                                <SelectItem value="missing">{translate("待补充")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="min-w-0 text-xs font-semibold text-slate-600">
                            {translate("更新日期")}
                            <Input
                              type="date"
                              value={document.updatedAt}
                              disabled={saving}
                              onChange={(event) => updateDocument({ updatedAt: event.target.value })}
                              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                            />
                          </label>
                          <Button variant="unstyled"
                            type="button"
                            title={translate("删除材料")}
                            aria-label={translate("删除材料")}
                            disabled={saving}
                            onClick={() => setPendingDocumentIndex(index)}
                            className="mt-5 flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 bg-white text-red-500 transition hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <label className="mt-3 block text-xs font-semibold text-slate-600">
                          {translate("核对说明")}
                          <Textarea
                            rows={2}
                            value={document.detail}
                            disabled={saving}
                            onChange={(event) => updateDocument({ detail: event.target.value })}
                            className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          {error ? (
            <p id="employee-archive-editor-error" className="text-pretty text-xs font-medium text-red-600" role="alert">{error}</p>
          ) : (
            <p className="hidden text-pretty text-xs text-muted-foreground sm:block">{translate("保存后将重新计算归档完整度和缺失字段")}</p>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="unstyled"
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="material-button-secondary px-4 py-2.5 text-sm disabled:opacity-50"
            >
              {translate("取消")}
            </Button>
            <Button variant="unstyled"
              type="submit"
              disabled={saving}
              className="material-button-primary min-w-28 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {translate(saving ? "保存中" : mode === "create" ? "新增并保存" : "保存修改")}
            </Button>
          </div>
        </footer>
        </form>
        <AlertDialog open={pendingDocumentIndex !== null} onOpenChange={(open) => { if (!open) setPendingDocumentIndex(null); }}>
          <AlertDialogContent className="horizon-portal">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-balance">{translate("删除材料记录？")}</AlertDialogTitle>
              <AlertDialogDescription className="text-pretty">
                {translate("该材料记录将从当前编辑草稿中移除，保存人员档案后生效。")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{translate("取消")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  if (pendingDocumentIndex !== null) {
                    onDocumentsChange(draft.docs.filter((_, itemIndex) => itemIndex !== pendingDocumentIndex));
                  }
                  setPendingDocumentIndex(null);
                }}
              >
                {translate("确认删除")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeDeleteDialog({
  employee,
  deleting,
  onCancel,
  onConfirm,
}: {
  employee: EmployeeArchive;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !deleting) onCancel(); }}>
      <AlertDialogContent className="horizon-portal">
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-left">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <AlertDialogTitle className="text-balance">{translate("删除人员档案")}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-pretty leading-6">
                {translate("确认删除 {name}（{number}）吗？人员信息、材料记录和胸牌配置会一并删除。", { name: employee.name, number: employee.rosterNo })}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting} onClick={onCancel}>{translate("取消")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            className="min-w-28 bg-red-600 text-white hover:bg-red-700"
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {deleting ? <Loader2 className="motion-safe:animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            {translate(deleting ? "删除中" : "确认删除")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmployeeRegularizationDialog({
  employee,
  saving,
  onCancel,
  onConfirm,
}: {
  employee: EmployeeArchive;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (regularizationDate: string) => void;
}) {
  const today = formatLocalDate(new Date());
  const expectedDate = getExpectedRegularizationDate(employee);
  const [regularizationDate, setRegularizationDate] = useState(today);
  const selectedDate = parseLocalDate(regularizationDate);
  const hireDate = parseLocalDate(employee.hireDate);
  const expected = parseLocalDate(expectedDate);
  const earlyDays = selectedDate && expected && selectedDate < expected
    ? differenceInCalendarDays(expected, selectedDate)
    : 0;
  const isValidDate = Boolean(
    selectedDate
      && hireDate
      && selectedDate >= hireDate
      && regularizationDate <= today,
  );

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <AlertDialogContent className="horizon-portal gap-0 overflow-hidden p-0 sm:max-w-lg">
          <AlertDialogHeader className="border-b border-slate-100 bg-emerald-50 p-5 text-left">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <BadgeCheck className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <AlertDialogTitle className="text-balance text-lg font-semibold text-slate-950">
                  {translate("确认员工转正")}
                </AlertDialogTitle>
                <AlertDialogDescription className="mt-1 text-pretty text-sm leading-6 text-slate-600">
                  {translate("确认后将更新员工状态，并保存实际转正日期。")}
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="space-y-4 p-5">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
              <span className="material-table-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
                {getInitial(employee.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-950">{employee.name}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {employee.employeeCode || translate("工号待补充")} · {employee.department || translate("部门待补充")} · {employee.title || translate("岗位待补充")}
                </p>
              </div>
              <span className="material-chip shrink-0 bg-blue-50 text-blue-700">{translate(employee.status || "在职")}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="employee-regularization-date" className="text-xs text-slate-600">{translate("实际转正日期")}</Label>
                <Input
                  id="employee-regularization-date"
                  type="date"
                  value={regularizationDate}
                  min={employee.hireDate || undefined}
                  max={today}
                  onChange={(event) => setRegularizationDate(event.target.value)}
                  autoFocus
                  aria-invalid={!isValidDate}
                  aria-describedby={!isValidDate ? "employee-regularization-error" : undefined}
                />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
                <p className="text-xs font-semibold text-slate-500">{translate("预计转正日期")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{expectedDate || translate("待补充")}</p>
              </div>
            </div>

            {earlyDays > 0 ? (
              <div className="flex gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs leading-5">
                  {translate("本次为提前转正，比预计日期提前 {days} 天。请确认日期与审批结果一致。", { days: earlyDays })}
                </p>
              </div>
            ) : (
              <div className="flex gap-2.5 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3 text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-xs leading-5">{translate("系统将记录本次操作人员和转正日期。")}</p>
              </div>
            )}

            {!isValidDate ? (
              <p id="employee-regularization-error" className="text-pretty text-xs font-medium text-red-600" role="alert">{translate("转正日期须介于入职日期和今天之间。")}</p>
            ) : null}
          </div>

          <AlertDialogFooter className="border-t border-slate-100 bg-slate-50 px-5 py-4">
            <AlertDialogCancel disabled={saving} onClick={onCancel}>
              {translate("取消")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || !isValidDate}
              onClick={(event) => { event.preventDefault(); onConfirm(regularizationDate); }}
              className="min-w-32 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving ? <Loader2 className="motion-safe:animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}
              {translate(saving ? "转正处理中" : "确认转正")}
            </AlertDialogAction>
          </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BadgePreview({
  employee,
  template,
  positions,
  avatarDraft,
  textVisibility,
  isPositionEditing,
  isPositionConfirmed,
  onMovePosition,
  compact = false,
}: {
  employee: EmployeeArchive;
  template: BadgeTemplate;
  positions: BadgeOverlayPositions;
  avatarDraft: BadgeAvatarDraft;
  textVisibility: BadgeTextVisibility;
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
  const positionStatus = translate(isPositionEditing ? "拖动调整中" : isPositionConfirmed ? "位置已固定" : "位置待确认");

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
        {translate(label)}
      </span>
    ) : null;

  return (
    <div className={cn("mx-auto w-full", compact ? "max-w-[210px]" : "max-w-[300px]")}>
      <div
        ref={previewRef}
        data-badge-preview={compact ? "compact" : "editor"}
        className="relative aspect-[154/245] w-full overflow-hidden rounded-[28px] shadow-[0_24px_54px_rgba(15,23,42,0.28)] ring-1 ring-slate-200"
        style={{ backgroundColor: template.primary }}
      >
        <img
          src={template.frontImage}
          alt={translate("{name}胸牌模板", { name: translate(template.name) })}
          className="absolute inset-0 h-full w-full object-fill"
          draggable={false}
        />

        {textVisibility.name ? (
          <div
            data-badge-field="name"
            className={cn(movableClassName("name"), "text-white")}
            style={overlayStyle("name")}
            onPointerDown={(event) => startDrag(event, "name")}
            onPointerMove={(event) => moveDrag(event, "name")}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {editLabel("姓名")}
            <div className="truncate text-[1.18rem] font-bold leading-tight">{employee.name}</div>
          </div>
        ) : null}

        {textVisibility.departmentCaption ? (
          <div
            data-badge-field="departmentCaption"
            className={cn(movableClassName("departmentCaption"), "text-white/70")}
            style={overlayStyle("departmentCaption")}
            onPointerDown={(event) => startDrag(event, "departmentCaption")}
            onPointerMove={(event) => moveDrag(event, "departmentCaption")}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {editLabel("标签")}
            <div className="truncate text-[10px] font-semibold leading-none">{translate("所属部门")}</div>
          </div>
        ) : null}

        {textVisibility.department ? (
          <div
            data-badge-field="department"
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
        ) : null}

        {textVisibility.title ? (
          <div
            data-badge-field="title"
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
        ) : null}

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
              alt={translate("{name}头像", { name: employee.name })}
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
              aria-label={translate("拉伸头像宽高")}
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

        {textVisibility.employeeId ? (
          <div
            data-badge-field="employeeId"
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
              className="absolute left-0 top-[7%] text-[0.86rem] font-black leading-none"
              style={{ color: template.primary }}
            >
              {badgeId}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: template.primary }} />
        {translate(template.name)} · {positionStatus} · {translate(template.name)}.jpeg
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
        <span className="truncate">{translate(label)}</span>
        <span className="shrink-0 tabular-nums text-slate-700">
          {value}
          {suffix}
        </span>
      </span>
      <Slider aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={([nextValue]) => onChange(nextValue)}
        className="mt-2 h-2 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
      />
    </label>
  );
}

function BadgeAvatarEditor({
  employee,
  avatarDraft,
  photoPosition,
  onUpload,
  onSave,
  saving,
  onRemove,
  onChangeAvatar,
  onChangePhotoPosition,
}: {
  employee: EmployeeArchive;
  avatarDraft: BadgeAvatarDraft;
  photoPosition: BadgeOverlayPosition;
  onUpload: () => void;
  onSave: () => void;
  saving: boolean;
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
              <p className="truncate text-sm font-semibold text-slate-900">{translate("头像图片")}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {hasAvatar ? avatarDraft.fileName ?? translate("胸牌头像") : translate("未上传")}
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
          {translate(!hasAvatar ? "待上传" : avatarDraft.savedLocal ? "服务端已保存" : "待保存")}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="unstyled" type="button" onClick={onUpload} className="material-button-secondary px-3 py-2 text-xs">
          <Upload className="h-4 w-4" />
          {translate("上传")}
        </Button>
        <Button variant="unstyled"
          type="button"
          onClick={onSave}
          disabled={!hasAvatar || saving}
          className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {translate(saving ? "保存中" : "保存头像")}
        </Button>
        <Button variant="unstyled"
          type="button"
          onClick={onRemove}
          disabled={!hasAvatar}
          className="material-button-secondary px-3 py-2 text-xs text-red-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Trash2 className="h-4 w-4" />
          {translate("移除")}
        </Button>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[120px_minmax(0,1fr)]">
        <div className="flex min-h-[132px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {hasAvatar ? (
            <div className="relative h-28 w-24 overflow-hidden rounded-2xl bg-white shadow-inner">
              <img
                src={avatarDraft.dataUrl}
                alt={translate("{name}头像预览", { name: employee.name })}
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
  useI18n();
  const { items: departmentDirectory } = useDepartmentDirectory();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);
  // 花名册数据：启动时先显示本地缓存，随后由服务端数据覆盖；不再把演示人员当成真实档案展示。
  const [employees, setEmployees] = useState<EmployeeArchive[]>(() => loadStoredEmployees() ?? []);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState<ArchiveStatus | "全部">("全部");
  const [birthdayOnly, setBirthdayOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(() => (loadStoredEmployees() ?? [])[0]?.id ?? "");
  const [badgeTemplateKey, setBadgeTemplateKey] = useState<BadgeTemplateKey>("official");
  const [badgePositions, setBadgePositions] = useState<BadgeLayoutPositions>(() => createBadgeLayoutPositions());
  const [badgePositionConfirmed, setBadgePositionConfirmed] = useState<Record<BadgeTemplateKey, boolean>>(
    () => createBadgePositionConfirmed(),
  );
  const [badgeAvatarDrafts, setBadgeAvatarDrafts] = useState<Record<string, BadgeAvatarDraft>>(
    () => loadBadgeAvatarDrafts(),
  );
  const [badgeTextVisibility, setBadgeTextVisibility] = useState<BadgeTextVisibilityByTemplate>(
    () => loadBadgeTextVisibility(),
  );
  const [isBadgePositionEditing, setIsBadgePositionEditing] = useState(false);
  const [isBadgeEditorOpen, setIsBadgeEditorOpen] = useState(false);
  const [isBadgeExporting, setIsBadgeExporting] = useState(false);
  const [view, setView] = useState<"list" | "detail">("list");
  const [listPage, setListPage] = useState(1);
  const [listColumnVisibility, setListColumnVisibility] = useState<Record<EmployeeListColumnKey, boolean>>(
    () => loadEmployeeListColumnVisibility(),
  );
  const [employeeEditDraft, setEmployeeEditDraft] = useState<EmployeeArchiveEditDraft | null>(null);
  const [employeeEditMode, setEmployeeEditMode] = useState<"create" | "edit">("edit");
  const [isEmployeeSaving, setIsEmployeeSaving] = useState(false);
  const [employeeEditError, setEmployeeEditError] = useState("");
  const [employeePendingDelete, setEmployeePendingDelete] = useState<EmployeeArchive | null>(null);
  const [isEmployeeDeleting, setIsEmployeeDeleting] = useState(false);
  const [employeePendingRegularization, setEmployeePendingRegularization] = useState<EmployeeArchive | null>(null);
  const [isEmployeeRegularizing, setIsEmployeeRegularizing] = useState(false);
  const [serverStats, setServerStats] = useState<EmployeeArchiveStats | null>(null);
  const [serverProbationReminders, setServerProbationReminders] = useState<Record<string, EmployeeProbationReminder>>({});
  const [isBadgeConfigSaving, setIsBadgeConfigSaving] = useState(false);

  useEffect(
    () =>
      subscribeDepartmentChanges((change) => {
        if (change.previousName === change.name) return;
        setEmployees((current) => {
          let changed = false;
          const next = current.map((employee) => {
            if (employee.department !== change.previousName) return employee;
            changed = true;
            return { ...employee, department: change.name };
          });
          if (changed) saveStoredEmployees(next);
          return changed ? next : current;
        });
      }),
    [],
  );

  const refreshArchiveMeta = async (signal?: AbortSignal) => {
    const [statsResult, remindersResult] = await Promise.allSettled([
      getEmployeeArchiveStats(signal),
      listEmployeeProbationReminders(signal),
    ]);
    if (signal?.aborted) return;
    if (statsResult.status === "fulfilled") setServerStats(statsResult.value);
    if (remindersResult.status === "fulfilled") {
      setServerProbationReminders(Object.fromEntries(
        remindersResult.value.items.map((item) => [item.employee.id, item]),
      ));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await listEmployeeArchives(controller.signal);
        if (controller.signal.aborted) return;
        if (result.items.length > 0) {
          setEmployees(result.items);
          saveStoredEmployees(result.items);
          setSelectedId((current) =>
            result.items.some((employee) => employee.id === current) ? current : result.items[0].id,
          );
        } else {
          // 首次启用接口时，将浏览器中真实导入过的花名册平滑迁移到服务端；没有真实数据则展示空状态。
          const stored = loadStoredEmployees();
          if (stored?.length) {
            const migrated = await importEmployeeArchives(stored, false);
            if (controller.signal.aborted) return;
            setEmployees(migrated.items);
            saveStoredEmployees(migrated.items);
            setSelectedId(migrated.items[0]?.id ?? "");
          } else {
            setEmployees([]);
            saveStoredEmployees([]);
            setSelectedId("");
          }
        }
        await refreshArchiveMeta(controller.signal);
      } catch {
        // 开发环境后端未启动或临时不可用时继续使用本地缓存，不打断当前页面操作。
      }
    })();
    return () => controller.abort();
  }, []);

  const companies = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.company).filter(Boolean))),
    [employees],
  );

  const filteredEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const filtered = employees.filter((employee) => {
      const matchesKeyword =
        !keyword ||
        [
          employee.name,
          employee.company,
          employee.department,
          employee.title,
          employee.status,
          employee.workLocation,
          employee.employeeCode,
          employee.costCenter,
        ]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const matchesCompany = companyFilter === "全部" || employee.company === companyFilter;
      const matchesStatus = statusFilter === "全部" || employee.archiveStatus === statusFilter;
      const matchesBirthday = !birthdayOnly || Boolean(getEmployeeBirthdayReminder(employee));
      return matchesKeyword && matchesCompany && matchesStatus && matchesBirthday;
    });
    return birthdayOnly
      ? filtered.sort((a, b) =>
          (getEmployeeBirthdayReminder(a)?.day ?? 32) - (getEmployeeBirthdayReminder(b)?.day ?? 32),
        )
      : filtered;
  }, [birthdayOnly, companyFilter, search, statusFilter, employees]);

  useEffect(() => {
    setListPage(1);
  }, [birthdayOnly, companyFilter, search, statusFilter]);

  const selected = employees.find((employee) => employee.id === selectedId) ?? employees[0] ?? EMPTY_EMPLOYEE_ARCHIVE;

  useEffect(() => {
    if (!employees.some((employee) => employee.id === selected.id)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const config = await getEmployeeBadgeConfig(selected.id, controller.signal);
        if (controller.signal.aborted) return;
        const defaultPositions = createBadgeLayoutPositions();
        const savedPositions = (config.positions ?? {}) as Partial<BadgeLayoutPositions>;
        const nextPositions = Object.fromEntries(
          badgeTemplates.map((template) => [
            template.key,
            { ...defaultPositions[template.key], ...(savedPositions[template.key] ?? {}) },
          ]),
        ) as BadgeLayoutPositions;
        const defaultVisibility = createBadgeTextVisibilityByTemplate();
        const savedVisibility = (config.textVisibility ?? {}) as Partial<BadgeTextVisibilityByTemplate>;
        const nextVisibility = Object.fromEntries(
          badgeTemplates.map((template) => [
            template.key,
            { ...defaultVisibility[template.key], ...(savedVisibility[template.key] ?? {}) },
          ]),
        ) as BadgeTextVisibilityByTemplate;
        setBadgePositions(nextPositions);
        setBadgeTextVisibility(nextVisibility);
        setBadgePositionConfirmed({
          ...createBadgePositionConfirmed(),
          ...((config.positionConfirmed ?? {}) as Partial<Record<BadgeTemplateKey, boolean>>),
        });
        if (config.templateKey && badgeTemplates.some((template) => template.key === config.templateKey)) {
          setBadgeTemplateKey(config.templateKey);
        }
        if (config.avatar?.signedUrl) {
          setBadgeAvatarDrafts((current) => ({
            ...current,
            [selected.id]: normalizeBadgeAvatarDraft({
              ...config.avatar,
              dataUrl: config.avatar?.signedUrl ?? undefined,
              savedLocal: true,
            }),
          }));
        }
      } catch {
        // 服务端暂无胸牌配置时继续使用浏览器本地草稿。
      }
    })();
    return () => controller.abort();
  }, [selected.id]);

  const startEmployeeEdit = (employee: EmployeeArchive = selected) => {
    setEmployeeEditError("");
    setSelectedId(employee.id);
    setEmployeeEditMode("edit");
    setEmployeeEditDraft({
      ...employee,
      docs: employee.docs.map((doc) => ({ ...doc })),
      missingFields: [...employee.missingFields],
      alerts: [...employee.alerts],
      identityNumber: "",
      phoneNumber: "",
      bankAccount: "",
      emergencyPhoneNumber: "",
      socialSecurityNumber: "",
    });
  };

  const startEmployeeCreate = () => {
    setEmployeeEditError("");
    const employee = createEmptyEmployeeArchive(`emp-${Date.now()}`);
    setEmployeeEditMode("create");
    setEmployeeEditDraft({
      ...employee,
      identityNumber: "",
      phoneNumber: "",
      bankAccount: "",
      emergencyPhoneNumber: "",
      socialSecurityNumber: "",
    });
  };

  const toggleListColumn = (key: EmployeeListColumnKey) => {
    setListColumnVisibility((current) => {
      const visibleCount = EMPLOYEE_LIST_COLUMNS.filter((column) => current[column.key]).length;
      if (current[key] && visibleCount <= 1) return current;
      const next = { ...current, [key]: !current[key] };
      persistEmployeeListColumnVisibility(next);
      return next;
    });
  };

  const resetListColumns = () => {
    const next = Object.fromEntries(EMPLOYEE_LIST_COLUMNS.map((column) => [column.key, true])) as Record<
      EmployeeListColumnKey,
      boolean
    >;
    setListColumnVisibility(next);
    persistEmployeeListColumnVisibility(next);
  };

  const updateEmployeeEditDraft = (key: keyof EmployeeArchiveEditDraft, value: string) => {
    if (employeeEditError) setEmployeeEditError("");
    setEmployeeEditDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const updateEmployeeEditDocuments = (documents: DocItem[]) => {
    setEmployeeEditDraft((current) => current ? { ...current, docs: documents } : current);
  };

  const saveEmployeeEdit = async () => {
    if (!employeeEditDraft) return;
    if (!employeeEditDraft.name.trim() || !employeeEditDraft.rosterNo.trim()) {
      setEmployeeEditError(translate("姓名和序号不能为空"));
      return;
    }

    setEmployeeEditError("");
    setIsEmployeeSaving(true);
    try {
      const {
        identityNumber,
        phoneNumber,
        bankAccount,
        emergencyPhoneNumber,
        socialSecurityNumber,
        ...record
      } = employeeEditDraft;
      const sensitiveUpdate = {
        ...(identityNumber.trim() ? { identityNumber: identityNumber.trim() } : {}),
        ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
        ...(bankAccount.trim() ? { bankAccount: bankAccount.trim() } : {}),
        ...(emergencyPhoneNumber.trim() ? { emergencyPhoneNumber: emergencyPhoneNumber.trim() } : {}),
        ...(socialSecurityNumber.trim() ? { socialSecurityNumber: socialSecurityNumber.trim() } : {}),
      };
      const updated = employeeEditMode === "create"
        ? await createEmployeeArchive(record, sensitiveUpdate)
        : await saveEmployeeArchive(record, sensitiveUpdate);
      const nextEmployees = employees.some((employee) => employee.id === record.id)
        ? employees.map((employee) => employee.id === record.id ? updated : employee)
        : [...employees, updated];
      setEmployees(nextEmployees);
      saveStoredEmployees(nextEmployees);
      setSelectedId(updated.id);
      setEmployeeEditDraft(null);
      setEmployeeEditError("");
      setView("detail");
      void refreshArchiveMeta();
      toast.success(employeeEditMode === "create" ? translate("{name} 已新增", { name: updated.name }) : translate("{name} 的人员信息已保存", { name: updated.name }));
    } catch (error) {
      const message = error instanceof Error ? translate("保存失败：{message}", { message: error.message }) : translate("保存失败，请稍后重试");
      setEmployeeEditError(message);
      toast.error(message);
    } finally {
      setIsEmployeeSaving(false);
    }
  };

  const confirmEmployeeDelete = async () => {
    if (!employeePendingDelete) return;
    setIsEmployeeDeleting(true);
    try {
      await deleteEmployeeArchive(employeePendingDelete.id);
      const nextEmployees = employees.filter((employee) => employee.id !== employeePendingDelete.id);
      setEmployees(nextEmployees);
      saveStoredEmployees(nextEmployees);
      setBadgeAvatarDrafts((current) => {
        const next = { ...current };
        delete next[employeePendingDelete.id];
        persistBadgeAvatarDrafts(next);
        return next;
      });
      setEmployeePendingDelete(null);
      setSelectedId(nextEmployees[0]?.id ?? "");
      setView("list");
      void refreshArchiveMeta();
      toast.success(translate("人员档案已删除"));
    } catch (error) {
      toast.error(error instanceof Error ? translate("删除失败：{message}", { message: error.message }) : translate("删除失败，请稍后重试"));
    } finally {
      setIsEmployeeDeleting(false);
    }
  };

  const confirmEmployeeRegularization = async (regularizationDate: string) => {
    if (!employeePendingRegularization) return;
    setIsEmployeeRegularizing(true);
    try {
      const updated = await regularizeEmployeeArchive(employeePendingRegularization.id, regularizationDate);
      const nextEmployees = employees.map((employee) => employee.id === updated.id ? updated : employee);
      setEmployees(nextEmployees);
      saveStoredEmployees(nextEmployees);
      setSelectedId(updated.id);
      setEmployeePendingRegularization(null);
      void refreshArchiveMeta();
      toast.success(translate("{name} 已于 {date} 转正", { name: updated.name, date: updated.regularizationDate }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? translate("转正失败：{message}", { message: error.message })
          : translate("转正失败，请稍后重试"),
      );
    } finally {
      setIsEmployeeRegularizing(false);
    }
  };

  // 导入花名册：前端解析 xlsx 并脱敏，服务端持久化；接口不可用时保留本地兜底。
  const handleRosterImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const { items: parsed, headerFound } = await parseRosterWorkbook(await file.arrayBuffer());
      if (parsed.length === 0) {
        toast.error(
          headerFound
            ? translate("已识别花名册表头，但未发现员工数据，请从表头下一行开始填写")
            : translate("未识别到花名册表头，请检查是否包含「姓名 / 证件号码」"),
        );
        return;
      }
      let nextEmployees = parsed;
      let persistedToServer = false;
      try {
        // 页面导入采用安全合并：同序号更新、新序号新增，不自动删除文件中未出现的员工。
        const imported = await importEmployeeArchives(parsed, false);
        nextEmployees = imported.items;
        persistedToServer = true;
      } catch (apiError) {
        toast.warning(
          apiError instanceof Error
            ? translate("服务端保存失败，已暂存本机：{message}", { message: apiError.message })
            : translate("服务端保存失败，已暂存本机"),
        );
      }
      setEmployees(nextEmployees);
      saveStoredEmployees(nextEmployees);
      setSelectedId(nextEmployees[0]?.id ?? "");
      setListPage(1);
      setCompanyFilter("全部");
      setStatusFilter("全部");
      setBirthdayOnly(false);
      if (persistedToServer) void refreshArchiveMeta();
      toast.success(persistedToServer
        ? translate("已导入 {count} 名员工，按 {required} 个必备字段完成核对并保存到服务端", { count: parsed.length, required: REQUIRED_COLUMN_COUNT })
        : translate("已导入 {count} 名员工，按 {required} 个必备字段完成核对", { count: parsed.length, required: REQUIRED_COLUMN_COUNT }));
    } catch (err) {
      toast.error(err instanceof Error ? translate("导入失败：{message}", { message: err.message }) : translate("导入失败，请确认文件为 .xlsx 花名册"));
    }
  };
  const handleRosterExport = async () => {
    if (filteredEmployees.length === 0) {
      toast.info(translate("当前筛选条件下暂无人员可导出"));
      return;
    }
    try {
      await exportEmployeeRoster(filteredEmployees);
      toast.success(translate("已导出 {count} 人的人员名单", { count: filteredEmployees.length }));
    } catch {
      toast.error(translate("导出失败，请重试"));
    }
  };
  const badgeEmployeeId = getBadgeEmployeeId(selected);
  const activeBadgeTemplate = getBadgeTemplate(badgeTemplateKey);
  const activeBadgePositions = badgePositions[badgeTemplateKey];
  const isActiveBadgePositionConfirmed = badgePositionConfirmed[badgeTemplateKey];
  const activeBadgeAvatarDraft = badgeAvatarDrafts[selected.id] ?? createBadgeAvatarDraft();
  const activeBadgeTextVisibility = badgeTextVisibility[badgeTemplateKey];
  const visibleBadgeTextCount = badgeTextFieldOptions.filter(
    (field) => activeBadgeTextVisibility[field.key],
  ).length;
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
            ? activeBadgeAvatarDraft.fileName ?? "胸牌头像"
            : "待上传标准证件照",
          status: activeBadgeAvatarDraft.dataUrl
            ? activeBadgeAvatarDraft.savedLocal
              ? "ready"
              : "warning"
            : "missing",
          required: true,
          helper: activeBadgeAvatarDraft.dataUrl
            ? activeBadgeAvatarDraft.savedLocal
              ? "头像与裁剪参数已保存到服务端"
              : "已载入，待保存到服务端"
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
          value: `PNG · ${BADGE_EXPORT_WIDTH} x ${BADGE_EXPORT_HEIGHT}`,
          status: "ready",
          required: false,
          helper: `按当前预览导出，显示 ${visibleBadgeTextCount}/${badgeTextFieldOptions.length} 个文本字段`,
        },
      ];
    },
    [
      activeBadgeAvatarDraft,
      activeBadgeTemplate,
      badgeEmployeeId,
      isActiveBadgePositionConfirmed,
      selected,
      visibleBadgeTextCount,
    ],
  );
  const requiredBadgeItems = badgeRequirements.filter((item) => item.required);
  const badgeBlockingItems = requiredBadgeItems.filter((item) => item.status === "missing");
  const badgeWarningItems = badgeRequirements.filter((item) => item.status === "warning");
  const badgeReadyRequiredCount = requiredBadgeItems.filter((item) => item.status === "ready").length;
  const completedDocCount = selected.docs.filter((doc) => doc.status === "done").length;
  const reviewDocCount = selected.docs.filter((doc) => doc.status === "review").length;
  const missingDocCount = selected.docs.filter((doc) => doc.status === "missing").length;
  const probationReminderFor = (employee: EmployeeArchive): ProbationReminder | null => {
    const serverReminder = serverProbationReminders[employee.id];
    return serverReminder
      ? {
          conversionDate: serverReminder.conversionDate,
          reminderDate: serverReminder.reminderDate,
          daysUntilConversion: serverReminder.daysUntilConversion,
          phase: serverReminder.phase,
        }
      : getProbationReminder(employee);
  };
  const selectedProbationReminder = probationReminderFor(selected);
  const hasSelectedProbationReminder = selectedProbationReminder?.phase === "active";
  const probationReminderCount = employees.reduce((count, employee) => {
    const reminder = probationReminderFor(employee);
    return reminder?.phase === "active" ? count + 1 : count;
  }, 0);
  const birthdayReminderCount = employees.reduce(
    (count, employee) => count + (getEmployeeBirthdayReminder(employee) ? 1 : 0),
    0,
  );
  const selectedBirthdayReminder = getEmployeeBirthdayReminder(selected);
  const currentMonth = new Date().getMonth() + 1;
  const blockingActionCount = selected.missingFields.length + badgeBlockingItems.length;
  const pendingActionCount = blockingActionCount + (hasSelectedProbationReminder ? 1 : 0);
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

  const localStats = useMemo(() => {
    const total = employees.length;
    const completed = employees.filter((employee) => employee.archiveStatus === "complete").length;
    const needsAction = employees.filter((employee) => employee.archiveStatus !== "complete").length;
    const missing = employees.reduce((sum, employee) => sum + employee.missingFields.length, 0);
    return { total, completed, needsAction, missing };
  }, [employees]);
  const stats = serverStats
    ? {
        total: serverStats.total,
        completed: serverStats.complete,
        needsAction: serverStats.pending,
        missing: serverStats.missingFieldCount,
      }
    : localStats;

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

  const toggleBadgeTextVisibility = (fieldKey: BadgeTextFieldKey) => {
    const nextVisibility: BadgeTextVisibilityByTemplate = {
      ...badgeTextVisibility,
      [badgeTemplateKey]: {
        ...activeBadgeTextVisibility,
        [fieldKey]: !activeBadgeTextVisibility[fieldKey],
      },
    };
    setBadgeTextVisibility(nextVisibility);
    if (!persistBadgeTextVisibility(nextVisibility)) {
      toast.error(translate("文本显示设置保存失败"));
    }
  };

  const resetBadgePositions = () => {
    const defaultPositions = createBadgeOverlayPositions();
    setBadgePositions((current) => ({
      ...current,
      [badgeTemplateKey]: defaultPositions,
    }));
    setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: false }));
    toast.info(translate("{name}模板位置已重置", { name: translate(activeBadgeTemplate.name) }));
  };

  const toggleBadgePositionEditing = () => {
    if (isBadgePositionEditing) {
      setIsBadgePositionEditing(false);
      setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: true }));
      toast.success(translate("{name}模板位置已固定", { name: translate(activeBadgeTemplate.name) }));
      return;
    }
    setIsBadgePositionEditing(true);
    setBadgePositionConfirmed((current) => ({ ...current, [badgeTemplateKey]: false }));
    toast.info(translate("拖动姓名、头像、部门、职位、编号到设计稿标注位置"));
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
      toast.warning(translate("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl) {
        toast.error(translate("头像读取失败"));
        return;
      }
      setBadgeAvatarDrafts((current) => ({
        ...current,
        [selected.id]: normalizeBadgeAvatarDraft({
          ...(current[selected.id] ?? createBadgeAvatarDraft()),
          dataUrl,
          fileId: undefined,
          fileName: file.name,
          updatedAt: new Date().toISOString(),
          savedLocal: false,
        }),
      }));
      toast.success(translate("头像已载入，调整完成后请保存到服务端"));
    };
    reader.onerror = () => toast.error(translate("头像读取失败"));
    reader.readAsDataURL(file);
  };

  const handleSaveBadgeConfig = async () => {
    if (isBadgeConfigSaving) return;
    setIsBadgeConfigSaving(true);
    try {
      let nextAvatarDraft = activeBadgeAvatarDraft;
      if (activeBadgeAvatarDraft.dataUrl && !activeBadgeAvatarDraft.fileId) {
        const uploaded = await uploadEmployeeBadgeAvatar(
          selected.id,
          activeBadgeAvatarDraft.dataUrl,
          activeBadgeAvatarDraft.fileName ?? `${selected.name}-胸牌头像.png`,
        );
        nextAvatarDraft = {
          ...activeBadgeAvatarDraft,
          fileId: uploaded.fileId,
          fileName: uploaded.fileName,
          // 当前会话继续使用本地 Data URL，避免短期签名地址过期后预览失效。
          dataUrl: activeBadgeAvatarDraft.dataUrl,
        };
      }
      const config: EmployeeArchiveBadgeConfig = {
        templateKey: badgeTemplateKey,
        positions: badgePositions,
        positionConfirmed: badgePositionConfirmed,
        textVisibility: badgeTextVisibility,
        avatar: nextAvatarDraft.dataUrl
          ? {
              fileId: nextAvatarDraft.fileId,
              fileName: nextAvatarDraft.fileName,
              imageWidth: nextAvatarDraft.imageWidth,
              imageHeight: nextAvatarDraft.imageHeight,
              offsetX: nextAvatarDraft.offsetX,
              offsetY: nextAvatarDraft.offsetY,
              rotate: nextAvatarDraft.rotate,
              radius: nextAvatarDraft.radius,
            }
          : null,
      };
      const savedConfig = await saveEmployeeBadgeConfig(selected.id, config);
      const savedAvatarDraft = normalizeBadgeAvatarDraft({
        ...nextAvatarDraft,
        fileId: savedConfig.avatar?.fileId,
        fileName: savedConfig.avatar?.fileName ?? nextAvatarDraft.fileName,
        dataUrl: nextAvatarDraft.dataUrl || savedConfig.avatar?.signedUrl,
        updatedAt: new Date().toISOString(),
        savedLocal: true,
      });
      const nextDrafts = { ...badgeAvatarDrafts, [selected.id]: savedAvatarDraft };
      setBadgeAvatarDrafts(nextDrafts);
      persistBadgeAvatarDrafts(nextDrafts);
      setEmployees((current) => {
        const next = current.map((employee) =>
          employee.id === selected.id ? { ...employee, badgeConfig: savedConfig } : employee,
        );
        saveStoredEmployees(next);
        return next;
      });
      toast.success(translate("胸牌配置和头像已保存到服务端"));
    } catch (error) {
      toast.error(error instanceof Error ? translate("胸牌保存失败：{message}", { message: error.message }) : translate("胸牌保存失败，请稍后重试"));
    } finally {
      setIsBadgeConfigSaving(false);
    }
  };

  const handleExportBadgeImage = async () => {
    if (isBadgeExporting) return;
    setIsBadgeExporting(true);
    try {
      const blob = await renderBadgePng({
        employee: selected,
        template: activeBadgeTemplate,
        positions: activeBadgePositions,
        avatarDraft: activeBadgeAvatarDraft,
        textVisibility: activeBadgeTextVisibility,
      });
      downloadBadgeBlob(blob, selected, activeBadgeTemplate);
      toast.success(translate("胸牌 PNG 已导出（{width} × {height}）", { width: BADGE_EXPORT_WIDTH, height: BADGE_EXPORT_HEIGHT }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translate("胸牌图片导出失败，请重试"));
    } finally {
      setIsBadgeExporting(false);
    }
  };

  const removeBadgeAvatarDraft = () => {
    setBadgeAvatarDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[selected.id];
      if (!persistBadgeAvatarDrafts(nextDrafts)) {
        toast.error(translate("本地草稿更新失败"));
        return current;
      }
      return nextDrafts;
    });
    toast.info(translate("头像草稿已移除"));
  };

  return (
    <div className="horizon-theme hz-page flex h-full min-h-0 w-full min-w-0 flex-col gap-3 px-3 py-3 sm:px-4 lg:px-5">
      <Input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={translate("上传胸牌头像")}
        onChange={handleBadgeAvatarFileChange}
      />
      <Input
        ref={rosterInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        aria-label={translate("导入花名册文件")}
        onChange={handleRosterImport}
      />
      {employeeEditDraft ? (
        <EmployeeArchiveEditor
          draft={employeeEditDraft}
          mode={employeeEditMode}
          saving={isEmployeeSaving}
          error={employeeEditError}
          departmentOptions={departmentDirectory.filter((item) => item.enabled).map((item) => item.name)}
          onChange={updateEmployeeEditDraft}
          onDocumentsChange={updateEmployeeEditDocuments}
          onCancel={() => { setEmployeeEditDraft(null); setEmployeeEditError(""); }}
          onSave={saveEmployeeEdit}
        />
      ) : null}
      {employeePendingDelete ? (
        <EmployeeDeleteDialog
          employee={employeePendingDelete}
          deleting={isEmployeeDeleting}
          onCancel={() => setEmployeePendingDelete(null)}
          onConfirm={confirmEmployeeDelete}
        />
      ) : null}
      {employeePendingRegularization ? (
        <EmployeeRegularizationDialog
          employee={employeePendingRegularization}
          saving={isEmployeeRegularizing}
          onCancel={() => setEmployeePendingRegularization(null)}
          onConfirm={confirmEmployeeRegularization}
        />
      ) : null}

      <HorizonPageHeader
        Icon={Users}
        eyebrow="人事运营 / EMPLOYEE ARCHIVE"
        title={translate("员工档案与入职管理")}
        description={translate("集中维护员工主档、入职材料、归档完整度、转正提醒与胸牌配置。")}
        meta={
          <>
            <span>{translate("共 {count} 名员工", { count: stats.total })}</span>
            <span aria-hidden="true">·</span>
            <span>{translate("数据与组织目录同步")}</span>
          </>
        }
        actions={
          <ArchiveActions
            onCreate={startEmployeeCreate}
            onImport={() => rosterInputRef.current?.click()}
            onExport={handleRosterExport}
          />
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Users} label={translate("花名册人员")} value={stats.total} note={translate("{count} 人已完成", { count: stats.completed })} tone="brand" />
        <HorizonMetric Icon={FileCheck2} label={translate("已完成归档")} value={stats.completed} note={translate("字段与材料均已核对")} tone="success" />
        <HorizonMetric Icon={AlertTriangle} label={translate("待处理归档")} value={stats.needsAction} note={translate("缺项 / 复核 / 入职中")} tone="warning" />
        <HorizonMetric Icon={BadgeCheck} label={translate("转正提醒")} value={probationReminderCount} note={translate("最后一个月提醒")} tone="warning" />
        <HorizonMetric Icon={CakeSlice} label={translate("本月生日")} value={birthdayReminderCount} note={translate("{month} 月生日人员", { month: currentMonth })} tone="neutral" />
        <HorizonMetric Icon={XCircle} label={translate("字段缺口")} value={stats.missing} note={translate("来自 {count} 个必备字段", { count: REQUIRED_COLUMN_COUNT })} tone="danger" />
      </HorizonMetricGrid>

      {view === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="flex min-h-0 flex-1">
            <main className="hz-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="hz-toolbar shrink-0 border-b px-5 py-3">
                <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-balance font-semibold text-slate-900">{translate("员工与流程队列")}</h2>
                    <p className="mt-1 text-pretty text-sm text-slate-500">
                      {translate("共 {count} 条记录，点击详情再展开字段与材料。", { count: filteredEmployees.length })}
                    </p>
                  </div>

                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative w-full lg:w-72">
                      <Label htmlFor="employee-archive-search" className="sr-only">{translate("搜索花名册")}</Label>
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="employee-archive-search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={translate("搜索姓名、工号、部门、岗位...")}
                        className="bg-white pl-11"
                      />
                    </div>

                    <details className="relative shrink-0">
                      <summary className="material-button-secondary cursor-pointer list-none px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                        <SlidersHorizontal className="h-4 w-4" />
                        {translate("显示列")}
                      </summary>
                      <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-60 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
                        <div className="mb-2 flex items-center justify-between gap-3 px-1">
                          <span className="text-xs font-semibold text-slate-700">{translate("选择列表显示项")}</span>
                          <Button variant="unstyled"
                            type="button"
                            onClick={resetListColumns}
                            className="text-[11px] font-semibold text-primary hover:text-primary-hover"
                          >
                            {translate("恢复默认")}
                          </Button>
                        </div>
                        <div className="space-y-1">
                          {EMPLOYEE_LIST_COLUMNS.map((column) => {
                            const visibleCount = EMPLOYEE_LIST_COLUMNS.filter(
                              (item) => listColumnVisibility[item.key],
                            ).length;
                            const isLastVisible = listColumnVisibility[column.key] && visibleCount === 1;
                            return (
                              <label
                                key={column.key}
                                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
                              >
                                <span>{translate(column.label)}</span>
                                <Checkbox
                                  checked={listColumnVisibility[column.key]}
                                  disabled={isLastVisible}
                                  onCheckedChange={() => toggleListColumn(column.key)}
                                  className="size-4 rounded border-slate-300 accent-primary disabled:cursor-not-allowed"
                                />
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-2 px-1 text-[11px] leading-4 text-muted-foreground">{translate("设置会保存在当前浏览器。")}</p>
                      </div>
                    </details>

                    {/* 隶属筛选：用 Radix Select，避免原生 <select> 下拉在各浏览器/系统下
                        渲染成系统样式（蓝底高亮），与站内其余控件割裂 */}
                    <div className="relative w-full shrink-0 sm:w-36">
                      <Label htmlFor="employee-company-filter" className="sr-only">{translate("隶属")}</Label>
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Select value={companyFilter} onValueChange={setCompanyFilter}>
                        <SelectTrigger
                          id="employee-company-filter"
                          aria-label={translate("隶属")}
                          className="h-10 w-full cursor-pointer rounded-full border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-300 focus:border-primary data-[size=default]:h-10"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
                          <SelectItem value="全部">{translate("全部")}</SelectItem>
                          {companies.map((company) => (
                            <SelectItem key={company} value={company}>
                              {translate(company)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {statusFilters.map((filter) => (
                    <Button variant="unstyled"
                      key={filter.key}
                      type="button"
                      onClick={() => setStatusFilter(filter.key)}
                      aria-pressed={statusFilter === filter.key}
                      className={cn(
                        "cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-semibold transition",
                        statusFilter === filter.key
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                      )}
                    >
                      {translate(filter.label)}
                    </Button>
                  ))}
                  <span aria-hidden="true" className="mx-0.5 h-7 w-px bg-slate-200" />
                  <Button variant="unstyled"
                    type="button"
                    aria-pressed={birthdayOnly}
                    onClick={() => setBirthdayOnly((current) => !current)}
                    disabled={birthdayReminderCount === 0}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      birthdayOnly
                        ? "border-amber-300 bg-amber-100 text-amber-900"
                        : "border-amber-200 bg-amber-50/70 text-amber-800 hover:border-amber-300 hover:bg-amber-50",
                    )}
                  >
                    <CakeSlice className="size-3.5" />
                    {translate("本月生日")}
                    <span className="tabular-nums">{birthdayReminderCount}</span>
                  </Button>
                </div>
              </div>

              <div className="material-scrollbar min-h-0 flex-1 overflow-auto">
                <table
                  className="w-full table-fixed text-left"
                  style={{
                    minWidth: `${EMPLOYEE_LIST_COLUMNS.reduce(
                      (total, column) => total + (listColumnVisibility[column.key] ? column.width : 0),
                      EMPLOYEE_ACTION_COLUMN_WIDTH,
                    )}px`,
                  }}
                >
                  <caption className="sr-only">{translate("员工花名册与归档流程状态")}</caption>
                  <colgroup>
                    {EMPLOYEE_LIST_COLUMNS.filter((column) => listColumnVisibility[column.key]).map((column) => (
                      <col key={column.key} style={{ width: `${column.width}px` }} />
                    ))}
                    <col style={{ width: `${EMPLOYEE_ACTION_COLUMN_WIDTH}px` }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr>
                      {EMPLOYEE_LIST_COLUMNS.filter((column) => listColumnVisibility[column.key]).map((column) => (
                        <th key={column.key} scope="col" className={TABLE_HEADER_CLASS}>
                          {translate(column.label)}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className={cn(
                          TABLE_HEADER_CLASS,
                          "sticky right-0 z-20 bg-slate-50/95 text-right shadow-[-10px_0_14px_-14px_rgba(15,23,42,0.55)]",
                        )}
                      >
                        {translate("操作")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td
                          colSpan={EMPLOYEE_LIST_COLUMNS.filter((column) => listColumnVisibility[column.key]).length + 1}
                          className="p-0"
                        >
                          <HorizonEmptyState
                            Icon={Users}
                            title={translate("暂无匹配的花名册记录")}
                            description={translate("调整搜索或筛选条件，或者新增员工档案。")}
                            action={
                              <Button type="button" size="sm" variant="outline" onClick={() => { setSearch(""); setCompanyFilter("全部"); setStatusFilter("全部"); setBirthdayOnly(false); }}>
                                {translate("清除筛选")}
                              </Button>
                            }
                          />
                        </td>
                      </tr>
                    ) : (
                      pagedEmployees.map((employee) => {
                        const probationReminder = probationReminderFor(employee);
                        const showProbationReminder = probationReminder?.phase === "active";
                        const birthdayReminder = getEmployeeBirthdayReminder(employee);
                        const employeeConstellation = getEmployeeConstellation(employee);
                        const employeeIsRegularized = isEmployeeRegularized(employee);
                        const employeeCanRegularize = canRegularizeEmployee(employee);

                        return (
                          <tr
                            key={employee.id}
                            className={cn(
                              "group h-[72px] transition-colors",
                              birthdayReminder
                                ? "bg-amber-50/45 hover:bg-amber-50/75"
                                : "hover:bg-accent/25",
                            )}
                          >
                          {listColumnVisibility.employee ? <td className={TABLE_CELL_CLASS}>
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="material-table-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold">
                                {getInitial(employee.name)}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">{employee.name}</div>
                                <div className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                                  {translate("序号 {number}", { number: employee.rosterNo })}
                                </div>
                              </div>
                            </div>
                          </td> : null}
                          {listColumnVisibility.employeeCode ? <td className={TABLE_CELL_CLASS}>
                            <div className="truncate font-semibold text-slate-800">
                              {employee.employeeCode || translate("待补充")}
                            </div>
                          </td> : null}
                          {listColumnVisibility.constellation ? <td className={TABLE_CELL_CLASS}>
                            <div className="flex flex-col items-start gap-1.5">
                              {birthdayReminder ? (
                                <span
                                  data-birthday-reminder={employee.id}
                                  className="material-chip gap-1 whitespace-nowrap border border-amber-200 bg-amber-100 text-amber-900"
                                >
                                  <CakeSlice className="size-3.5 shrink-0" />
                                  {translate(birthdayReminder.isToday ? "今天生日" : "本月生日")}
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums">
                                    {translate("{month}月{day}日", {
                                      month: birthdayReminder.month,
                                      day: birthdayReminder.day,
                                    })}
                                  </span>
                                </span>
                              ) : null}
                              <span className={cn(
                                "material-chip",
                                employeeConstellation ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700",
                              )}>
                                {translate(employeeConstellation || "缺少出生日期")}
                              </span>
                            </div>
                          </td> : null}
                          {listColumnVisibility.organization ? <td className={TABLE_CELL_CLASS}>
                            <div className="truncate font-medium text-slate-800">{employee.company}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {employee.workLocation} · {employee.department}
                            </div>
                          </td> : null}
                          {listColumnVisibility.position ? <td className={TABLE_CELL_CLASS}>
                            <div className="truncate font-medium text-slate-800">{employee.title}</div>
                            <span className="material-chip mt-1 bg-blue-50 text-blue-700">{translate(employee.status)}</span>
                          </td> : null}
                          {listColumnVisibility.employment ? <td className={TABLE_CELL_CLASS}>
                            <div className="font-medium tabular-nums text-slate-800">{employee.hireDate}</div>
                            {employeeIsRegularized ? (
                              <div
                                data-regularization-date={employee.id}
                                className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600"
                              >
                                <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  {translate("已转正")} · {employee.regularizationDate || getExpectedRegularizationDate(employee) || translate("日期待补充")}
                                </span>
                              </div>
                            ) : probationReminder ? (
                              <div
                                {...(showProbationReminder ? { "data-probation-reminder": employee.id } : { "data-expected-conversion": employee.id })}
                                className={cn(
                                  "mt-1 flex items-center gap-1 text-xs font-semibold",
                                  probationReminder.phase === "completed"
                                    ? "text-emerald-600"
                                    : probationReminder.phase === "active"
                                      ? "text-amber-600"
                                      : "text-muted-foreground",
                                )}
                              >
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  {translate(
                                    probationReminder.phase === "completed"
                                      ? "转正待确认"
                                      : probationReminder.phase === "active"
                                        ? "转正提醒"
                                        : "预计转正",
                                  )} · {probationReminder.conversionDate}
                                </span>
                              </div>
                            ) : null}
                          </td> : null}
                          {listColumnVisibility.archive ? <td className={TABLE_CELL_CLASS}>
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
                              <span className="text-sm font-bold tabular-nums text-slate-900">{employee.archiveScore}%</span>
                            </div>
                            <div className="mt-2">
                              <StatusBadge status={employee.archiveStatus} />
                            </div>
                          </td> : null}
                          {listColumnVisibility.missing ? <td className={TABLE_CELL_CLASS}>
                            {employee.missingFields.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {employee.missingFields.slice(0, 2).map((field) => (
                                  <span key={field} className="material-chip bg-red-50 text-red-700">
                                    {translate(field)}
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
                                {translate("无缺项")}
                              </span>
                            )}
                          </td> : null}
                          <td
                            className={cn(
                              TABLE_CELL_CLASS,
                              "sticky right-0 z-10 text-right shadow-[-10px_0_14px_-14px_rgba(15,23,42,0.45)] transition-colors",
                              birthdayReminder
                                ? "bg-amber-50 group-hover:bg-amber-50"
                                : "bg-white group-hover:bg-accent",
                            )}
                          >
                            <div className="flex items-center justify-end gap-1.5">
                              {employeeCanRegularize ? (
                                <Button variant="unstyled"
                                  type="button"
                                  onClick={() => setEmployeePendingRegularization(employee)}
                                  title={translate("将 {name} 转为正式员工", { name: employee.name })}
                                  aria-label={translate("将 {name} 转为正式员工", { name: employee.name })}
                                  className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                                >
                                  <BadgeCheck className="h-4 w-4" />
                                  {translate("转正")}
                                </Button>
                              ) : null}
                              <ActionIconButton
                                onClick={() => startEmployeeEdit(employee)}
                                title={translate("编辑 {name}", { name: employee.name })}
                                aria-label={translate("编辑 {name}", { name: employee.name })}
                              >
                                <Pencil className="h-4 w-4" />
                              </ActionIconButton>
                              <ActionIconButton
                                onClick={() => setEmployeePendingDelete(employee)}
                                title={translate("删除 {name}", { name: employee.name })}
                                aria-label={translate("删除 {name}", { name: employee.name })}
                                className="hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </ActionIconButton>
                              <ActionIconButton
                                onClick={() => openDetail(employee.id)}
                                title={translate("查看 {name} 详情", { name: employee.name })}
                                aria-label={translate("查看 {name} 详情", { name: employee.name })}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </ActionIconButton>
                            </div>
                          </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid shrink-0 gap-3 border-t border-slate-100 bg-white/95 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0 text-sm text-slate-500">
                  {translate("共 {count} 条记录", { count: filteredEmployees.length })}
                  <span className="mx-2 text-muted-foreground">/</span>
                  {translate("每页 {count} 条", { count: EMPLOYEE_PAGE_SIZE })}
                  <span className="mx-2 text-muted-foreground">/</span>
                  {translate("第 {page}/{total} 页", { page: currentPage, total: totalPages })}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setListPage(1)}
                    disabled={currentPage === 1}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {translate("首页")}
                  </Button>
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setListPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {translate("上一页")}
                  </Button>
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setListPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {translate("下一页")}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setListPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="material-button-secondary px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {translate("末页")}
                  </Button>
                </div>
              </div>
            </main>

          </section>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="hz-surface sticky top-0 z-20 mb-3 px-4 py-3">
            <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
              <Button variant="unstyled"
                type="button"
                onClick={() => setView("list")}
                className="material-button-secondary w-fit px-3 py-2 text-xs"
              >
                <ChevronLeft className="h-4 w-4" />
                {translate("返回列表")}
              </Button>

              <div className="flex min-w-0 items-center gap-3">
                <GenderDefaultAvatar employee={selected} className="h-11 w-11 rounded-xl" />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-balance text-lg font-semibold text-slate-950">{selected.name}</h2>
                    <StatusBadge status={selected.archiveStatus} />
                    <span className="material-chip bg-slate-50 text-slate-600">{badgeEmployeeId}</span>
                    {selectedBirthdayReminder ? (
                      <span
                        data-birthday-reminder={selected.id}
                        className="material-chip gap-1 whitespace-nowrap border border-amber-200 bg-amber-100 text-amber-900"
                      >
                        <CakeSlice className="size-3.5 shrink-0" />
                        {translate(selectedBirthdayReminder.isToday ? "今天生日" : "本月生日")}
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          {translate("{month}月{day}日", {
                            month: selectedBirthdayReminder.month,
                            day: selectedBirthdayReminder.day,
                          })}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-pretty text-sm text-slate-500">
                    {selected.company} · {selected.workLocation} · {selected.department} · {selected.title}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {canRegularizeEmployee(selected) ? (
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setEmployeePendingRegularization(selected)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                  >
                    <BadgeCheck className="h-4 w-4" />
                    {translate("转正")}
                  </Button>
                ) : null}
                <Button variant="unstyled"
                  type="button"
                  onClick={() => setEmployeePendingDelete(selected)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {translate("删除人员")}
                </Button>
                <Button variant="unstyled"
                  type="button"
                  onClick={() => startEmployeeEdit(selected)}
                  className="material-button-secondary px-3 py-2 text-xs"
                >
                  <Pencil className="h-4 w-4" />
                  {translate("编辑字段")}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <main className="min-w-0">
              <section className="hz-surface overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-primary">EMPLOYEE ARCHIVE</p>
                      <h3 className="mt-1 text-balance text-xl font-semibold text-slate-950">{translate("当前员工档案")}</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-5 lg:min-w-[700px]">
                      {[
                        { label: translate("入职"), value: selected.hireDate },
                        {
                          label: translate(isEmployeeRegularized(selected) ? "转正日期" : "预计转正"),
                          value: selected.regularizationDate
                            || selectedProbationReminder?.conversionDate
                            || getExpectedRegularizationDate(selected)
                            || translate("待补充"),
                        },
                        { label: translate("司龄"), value: translateTenure(selected.tenure) },
                        { label: translate("工号"), value: selected.employeeCode || translate("待补充") },
                        { label: translate("星座"), value: translate(getEmployeeConstellationDisplay(selected)) },
                      ].map((item) => (
                        <div key={item.label} className="min-w-0 border-l border-slate-200 pl-3">
                          <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                          <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-slate-900">{item.value}</p>
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
                              <h4 className="truncate text-sm font-semibold text-slate-950">{translate(group.title)}</h4>
                              <p className="mt-0.5 text-xs text-muted-foreground">{translate("{count} 项", { count: fields.length })}</p>
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
                          <h4 className="text-sm font-semibold text-slate-950">{translate("材料记录")}</h4>
                          <p className="mt-0.5 text-xs text-muted-foreground">{translate("{count} 项", { count: selected.docs.length })}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <span className="material-chip bg-emerald-50 text-emerald-700">{translate("已归档 {count}", { count: completedDocCount })}</span>
                        <span className="material-chip bg-amber-50 text-amber-700">{translate("待复核 {count}", { count: reviewDocCount })}</span>
                        <span className="material-chip bg-red-50 text-red-700">{translate("待补 {count}", { count: missingDocCount })}</span>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="hidden grid-cols-[minmax(0,1.05fr)_minmax(0,1.45fr)_96px_82px] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500 md:grid">
                        <span>{translate("材料")}</span>
                        <span>{translate("核对说明")}</span>
                        <span>{translate("更新")}</span>
                        <span className="text-right">{translate("状态")}</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {selected.docs.map((doc) => {
                          const meta = docStatusMeta[doc.status] ?? docStatusMeta.review;
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
                              <p className="text-xs tabular-nums text-muted-foreground">{doc.updatedAt}</p>
                              <div className="md:text-right">
                                <span className={cn("material-chip", meta.className)}>{translate(meta.label)}</span>
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
                          <IdCard className="h-4 w-4 text-muted-foreground" />
                          <h4 className="text-sm font-semibold text-slate-950">{translate("Excel 字段映射")}</h4>
                          <span className="material-chip bg-slate-50 text-slate-600">{translate("{count} 列", { count: sheetFields.length })}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {translate("结算日期不归档；其余 30 个业务字段为必备，社保号与社保首月日期为选填；司龄及出生相关字段自动计算。")}
                        </p>
                      </div>
                      <div className="flex max-w-3xl flex-wrap gap-1.5">
                        {sheetFields.map((field) => (
                          <span key={field} className="material-chip bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200">
                            {translate(field)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </main>

            <aside className="space-y-3 xl:sticky xl:top-[88px] xl:self-start">
              <section className="hz-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{translate("归档完成度")}</p>
                  <span className="text-2xl font-bold tabular-nums text-slate-950">{selected.archiveScore}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${selected.archiveScore}%` }} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-slate-50 px-2 py-2 text-center">
                    <p className="text-base font-bold tabular-nums text-slate-950">{selected.docs.length}</p>
                    <p className="text-[11px] font-semibold text-muted-foreground">{translate("材料")}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 px-2 py-2 text-center">
                    <p className="text-base font-bold tabular-nums text-red-700">{selected.missingFields.length}</p>
                    <p className="text-[11px] font-semibold text-red-400">{translate("缺项")}</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-2 py-2 text-center">
                    <p className="text-base font-bold tabular-nums text-amber-700">{reviewDocCount + badgeWarningItems.length}</p>
                    <p className="text-[11px] font-semibold text-amber-500">{translate("复核")}</p>
                  </div>
                </div>
              </section>

              <section className="hz-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <p className="text-sm font-semibold text-slate-900">{translate("待处理")}</p>
                  </div>
                  {pendingActionCount === 0 ? (
                    <span className="material-chip bg-emerald-50 text-emerald-700">{translate("无阻断")}</span>
                  ) : (
                    <span
                      className={cn(
                        "material-chip",
                        blockingActionCount > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700",
                      )}
                    >
                      {translate("{count} 项", { count: pendingActionCount })}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selected.missingFields.length > 0 ? (
                    selected.missingFields.map((field) => (
                      <span key={field} className="material-chip bg-red-50 text-red-700 ring-1 ring-inset ring-red-100">
                        {translate(field)}
                      </span>
                    ))
                  ) : (
                    <span className="material-chip gap-1 bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {translate("字段完整")}
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {hasSelectedProbationReminder && selectedProbationReminder ? (
                    <div
                      data-probation-reminder={selected.id}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800"
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold">
                        <Clock className="h-4 w-4 shrink-0" />
                        <span>{translate("试用期转正提醒")}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5">
                        {translate("预计 {date} 转正，距转正 {days} 天；已从 {reminderDate} 起进入提前一个月提醒期。", { date: selectedProbationReminder.conversionDate, days: selectedProbationReminder.daysUntilConversion, reminderDate: selectedProbationReminder.reminderDate })}
                      </p>
                    </div>
                  ) : null}
                  {selected.alerts.map((alert) => (
                    <p key={alert} className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-800">
                      {translate(alert)}
                    </p>
                  ))}
                </div>
              </section>

              <section className="hz-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{translate("胸牌")}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{translate(activeBadgeTemplate.name)} · {BADGE_PRINT_SIZE}</p>
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
                    {badgeBlockingItems.length > 0 ? translate("待补 {count}", { count: badgeBlockingItems.length }) : translate(isActiveBadgePositionConfirmed ? "可打印" : "待定位")}
                  </span>
                </div>
                <div className="mt-3">
                  <BadgePreview
                    employee={selected}
                    template={activeBadgeTemplate}
                    positions={activeBadgePositions}
                    avatarDraft={activeBadgeAvatarDraft}
                    textVisibility={activeBadgeTextVisibility}
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
                      <Button variant="unstyled"
                        key={template.key}
                        type="button"
                        onClick={() => setBadgeTemplateKey(template.key)}
                        aria-pressed={active}
                        className={cn(
                          "flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                          active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:bg-white/70",
                        )}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: template.primary }} />
                        <span className="truncate">{translate(template.name)}</span>
                      </Button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => void handleExportBadgeImage()}
                    disabled={isBadgeExporting}
                    className="material-button-secondary justify-center disabled:cursor-wait disabled:opacity-60"
                  >
                    {isBadgeExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {translate(isBadgeExporting ? "导出中" : "导出图片")}
                  </Button>
                  <Button variant="unstyled"
                    type="button"
                    onClick={() => setIsBadgeEditorOpen(true)}
                    className="material-button-primary justify-center"
                  >
                    <CreditCard className="h-4 w-4" />
                    {translate("编辑胸牌")}
                  </Button>
                </div>
              </section>
            </aside>
          </div>

          {isBadgeEditorOpen ? (
            <Dialog open onOpenChange={(open) => { if (!open) closeBadgeEditor(); }}>
              <DialogContent className="horizon-portal flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
                <DialogHeader className="min-w-0 border-b border-slate-100 px-5 py-4 pr-14 text-left">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <DialogTitle className="text-balance text-lg font-semibold text-slate-950">{translate("胸牌定制")}</DialogTitle>
                      <span className="material-chip bg-slate-50 text-slate-600">{translate(activeBadgeTemplate.name)}</span>
                      <span className="material-chip bg-slate-50 text-slate-600">{BADGE_PRINT_SIZE}</span>
                    </div>
                    <DialogDescription className="mt-1 text-pretty text-sm text-slate-500">{selected.name} · {selected.department} · {selected.title}</DialogDescription>
                  </div>
                </DialogHeader>

                <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[340px_minmax(0,1fr)]">
                  <aside className="min-h-0 overflow-y-auto border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
                    <div className="grid grid-cols-3 gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200">
                      {badgeTemplates.map((template) => {
                        const active = badgeTemplateKey === template.key;
                        return (
                          <Button variant="unstyled"
                            key={template.key}
                            type="button"
                            onClick={() => setBadgeTemplateKey(template.key)}
                            aria-pressed={active}
                            className={cn(
                              "flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                              active ? "bg-slate-50 text-slate-900 shadow-sm" : "text-slate-500 hover:bg-slate-50",
                            )}
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: template.primary }} />
                            <span className="truncate">{translate(template.name)}</span>
                          </Button>
                        );
                      })}
                    </div>

                    <div className="my-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Button variant="unstyled"
                        type="button"
                        onClick={toggleBadgePositionEditing}
                        aria-pressed={isBadgePositionEditing}
                        className={cn(
                          "inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition",
                          isBadgePositionEditing
                            ? "bg-primary text-white shadow-sm hover:bg-primary-hover"
                            : "border border-slate-200 bg-white text-slate-700 hover:border-primary/25 hover:bg-accent hover:text-primary-hover",
                        )}
                      >
                        {isBadgePositionEditing ? <CheckCircle2 className="h-4 w-4" /> : <Move className="h-4 w-4" />}
                        {translate(isBadgePositionEditing ? "确认位置" : "调整位置")}
                      </Button>
                      <ActionIconButton type="button" onClick={resetBadgePositions} title={translate("重置当前模板坐标")} aria-label={translate("重置当前模板坐标")}>
                        <RotateCcw className="h-4 w-4" />
                      </ActionIconButton>
                    </div>

                    <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{translate("文本显示")}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{translate("控制当前模板导出的文字内容")}</p>
                        </div>
                        <span aria-live="polite" className="material-chip bg-blue-50 text-blue-700">
                          {visibleBadgeTextCount}/{badgeTextFieldOptions.length}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {badgeTextFieldOptions.map((field) => {
                          const visible = activeBadgeTextVisibility[field.key];
                          return (
                            <Button variant="unstyled"
                              key={field.key}
                              type="button"
                              aria-pressed={visible}
                              data-badge-visibility-toggle={field.key}
                              onClick={() => toggleBadgeTextVisibility(field.key)}
                              className={cn(
                                "flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                                visible
                                  ? "border-primary/25 bg-accent text-primary hover:bg-accent"
                                  : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
                              )}
                            >
                              {visible ? <Eye className="h-3.5 w-3.5 shrink-0" /> : <EyeOff className="h-3.5 w-3.5 shrink-0" />}
                              <span className="truncate">{translate(field.label)}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    <BadgePreview
                      employee={selected}
                      template={activeBadgeTemplate}
                      positions={activeBadgePositions}
                      avatarDraft={activeBadgeAvatarDraft}
                      textVisibility={activeBadgeTextVisibility}
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
                              label: translate("必填完成"),
                              value: `${badgeReadyRequiredCount}/${requiredBadgeItems.length}`,
                              helper: translate("模板、定位、头像与员工信息"),
                              tone: "text-slate-900",
                            },
                            {
                              label: translate("待补"),
                              value: badgeBlockingItems.length,
                              helper: badgeBlockingItems.length > 0 ? badgeBlockingItems.map((item) => translate(item.label)).join(", ") : translate("无阻断项"),
                              tone: badgeBlockingItems.length > 0 ? "text-red-700" : "text-emerald-700",
                            },
                            {
                              label: translate("需确认"),
                              value: badgeWarningItems.length,
                              helper: badgeWarningItems.length > 0 ? badgeWarningItems.map((item) => translate(item.label)).join(", ") : translate("无提醒"),
                              tone: badgeWarningItems.length > 0 ? "text-amber-700" : "text-slate-600",
                            },
                          ].map((item) => (
                            <div key={item.label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
                              <p className="truncate text-xs font-semibold text-slate-500">{item.label}</p>
                              <div className={cn("mt-0.5 text-lg font-bold tabular-nums", item.tone)}>{item.value}</div>
                              <p className="mt-1 truncate text-xs text-slate-500">{item.helper}</p>
                            </div>
                          ))}
                        </div>

                        <BadgeAvatarEditor
                          employee={selected}
                          avatarDraft={activeBadgeAvatarDraft}
                          photoPosition={activeBadgePositions.photo}
                          onUpload={openBadgeAvatarUpload}
                          onSave={() => void handleSaveBadgeConfig()}
                          saving={isBadgeConfigSaving}
                          onRemove={removeBadgeAvatarDraft}
                          onChangeAvatar={updateBadgeAvatarDraft}
                          onChangePhotoPosition={(position) => updateBadgePosition("photo", position)}
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{translate("字段来源")}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{translate("从当前员工档案回填到模板。")}</p>
                            </div>
                            <span className="material-chip bg-white text-slate-600">{BADGE_PRINT_SIZE}</span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {[
                              { label: "模板", value: `${translate(activeBadgeTemplate.name)} (${translate(activeBadgeTemplate.name)}.jpeg)` },
                              { label: "姓名", value: selected.name },
                              { label: "部门", value: selected.department },
                              { label: "部门英文", value: departmentEnglish[selected.department] ?? "Office" },
                              { label: "职位", value: selected.title },
                              { label: "员工编号", value: badgeEmployeeId },
                            ].map((item) => (
                              <div key={item.label} className="min-w-0 border-b border-slate-200 pb-2">
                                <p className="truncate text-[11px] font-semibold text-muted-foreground">{translate(item.label)}</p>
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
                                  <span className="truncate text-sm font-semibold text-slate-800">{translate(item.label)}</span>
                                </div>
                                <div className="min-w-0">
                                  <p className={cn("truncate text-sm font-semibold", item.status === "ready" ? "text-slate-800" : item.status === "warning" ? "text-amber-700" : "text-red-700")}>
                                    {translate(item.value)}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{translate(item.helper)}</p>
                                </div>
                                <span className={cn("material-chip justify-center", meta.className)}>{translate(meta.label)}</span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => void handleSaveBadgeConfig()}
                            disabled={isBadgeConfigSaving}
                            className="material-button-secondary w-full justify-center disabled:cursor-wait disabled:opacity-60"
                          >
                            {isBadgeConfigSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {translate(isBadgeConfigSaving ? "保存中" : "保存胸牌配置")}
                          </Button>
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => void handleExportBadgeImage()}
                            disabled={isBadgeExporting}
                            className="material-button-primary w-full justify-center disabled:cursor-wait disabled:opacity-60"
                          >
                            {isBadgeExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {translate(isBadgeExporting ? "正在生成 PNG" : "导出胸牌 PNG")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </main>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      )}
    </div>
  );
}
