import React, { useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit2,
  FileText,
  Pencil,
  Search,
  Upload,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  name: string;
  empNo: string;
  dept: string;
  title: string;
  hireDate: string;
  contractExpiry: string;
}

interface DocField {
  label: string;
  value: string;
}

interface NotificationItem {
  docType: string;
  expiry: string;
  daysLeft: number;
  recipients: string;
  advanceDays: number;
}

interface NotificationLog {
  date: string;
  event: string;
  recipient: string;
}

const mockEmployees: Employee[] = [
  {
    id: "EMP-001",
    name: "王思远",
    empNo: "E20230118",
    dept: "研发部",
    title: "高级研发工程师",
    hireDate: "2023-01-18",
    contractExpiry: "2026-01-17",
  },
  {
    id: "EMP-002",
    name: "陈雅楠",
    empNo: "E20220601",
    dept: "质量部",
    title: "质量工程师",
    hireDate: "2022-06-01",
    contractExpiry: "2026-05-31",
  },
  {
    id: "EMP-003",
    name: "周子恬",
    empNo: "E20260110",
    dept: "市场部",
    title: "市场专员",
    hireDate: "2026-01-10",
    contractExpiry: "2026-06-09",
  },
];

const idCardFields: DocField[] = [
  { label: "姓名", value: "王思远" },
  { label: "身份证号", value: "110101199****1234" },
  { label: "出生日期", value: "1992-05-14" },
  { label: "地址", value: "北京市朝阳区建国路XX号" },
];

const educationFields: DocField[] = [
  { label: "学历", value: "本科" },
  { label: "毕业院校", value: "北京理工大学" },
  { label: "专业", value: "机械设计与制造" },
  { label: "毕业日期", value: "2015-07-01" },
];

const contractFields: DocField[] = [
  { label: "合同类型", value: "固定期限劳动合同" },
  { label: "签订日期", value: "2023-01-18" },
  { label: "到期日", value: "2026-01-17" },
  { label: "甲方单位", value: "INOGI 医疗科技（北京）有限公司" },
];

const docFieldsByEmployee: Record<string, Record<string, DocField[]>> = {
  "EMP-001": { id: idCardFields, edu: educationFields, contract: contractFields },
  "EMP-002": {
    id: [
      { label: "姓名", value: "陈雅楠" },
      { label: "身份证号", value: "310101199****5678" },
      { label: "出生日期", value: "1994-11-22" },
      { label: "地址", value: "上海市浦东新区张江路XX号" },
    ],
    edu: [
      { label: "学历", value: "硕士" },
      { label: "毕业院校", value: "同济大学" },
      { label: "专业", value: "生物医学工程" },
      { label: "毕业日期", value: "2019-06-15" },
    ],
    contract: [
      { label: "合同类型", value: "固定期限劳动合同" },
      { label: "签订日期", value: "2022-06-01" },
      { label: "到期日", value: "2026-05-31" },
      { label: "甲方单位", value: "INOGI 医疗科技（北京）有限公司" },
    ],
  },
  "EMP-003": {
    id: [
      { label: "姓名", value: "周子恬" },
      { label: "身份证号", value: "440101200****9012" },
      { label: "出生日期", value: "2001-03-08" },
      { label: "地址", value: "广州市天河区天河北路XX号" },
    ],
    edu: [
      { label: "学历", value: "本科" },
      { label: "毕业院校", value: "中山大学" },
      { label: "专业", value: "市场营销" },
      { label: "毕业日期", value: "2025-06-20" },
    ],
    contract: [
      { label: "合同类型", value: "固定期限劳动合同（试用期）" },
      { label: "签订日期", value: "2026-01-10" },
      { label: "到期日", value: "2026-06-09" },
      { label: "甲方单位", value: "INOGI 医疗科技（北京）有限公司" },
    ],
  },
};

const mockNotifications: Record<string, NotificationItem[]> = {
  "EMP-001": [
    { docType: "劳动合同", expiry: "2026-01-17", daysLeft: -89, recipients: "HR邮箱", advanceDays: 60 },
  ],
  "EMP-002": [
    { docType: "劳动合同", expiry: "2026-05-31", daysLeft: 45, recipients: "HR邮箱", advanceDays: 60 },
  ],
  "EMP-003": [
    { docType: "劳动合同（试用期）", expiry: "2026-06-09", daysLeft: 54, recipients: "HR邮箱, 部门主管", advanceDays: 30 },
  ],
};

const mockLogs: NotificationLog[] = [
  { date: "2026-04-01", event: "劳动合同即将到期提醒（EMP-002·45天）", recipient: "HR邮箱" },
  { date: "2026-03-15", event: "劳动合同续签提醒（EMP-001·已到期）", recipient: "HR邮箱, 法务部" },
  { date: "2026-02-28", event: "试用期转正提醒（EMP-003·60天）", recipient: "HR邮箱, 部门主管" },
];

type DocTab = "id" | "edu" | "contract";

const tabLabels: Record<DocTab, string> = {
  id: "身份证",
  edu: "学历证",
  contract: "劳动合同",
};

const tabFieldsKey: Record<DocTab, string> = {
  id: "id",
  edu: "edu",
  contract: "contract",
};

const daysColor = (days: number) => {
  if (days < 0) return "bg-red-100 text-red-600";
  if (days <= 30) return "bg-red-100 text-red-600";
  if (days <= 60) return "bg-orange-100 text-orange-600";
  return "bg-green-100 text-green-700";
};

const daysLabel = (days: number) => {
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今日到期";
  return `还有 ${days} 天`;
};

const contractDaysLeft = (expiry: string) => {
  const today = new Date("2026-04-16");
  const exp = new Date(expiry);
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// ─── Component ────────────────────────────────────────────────────────────────

export function EmployeeArchivePage() {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState<string>("EMP-001");
  const [docTab, setDocTab] = useState<DocTab>("id");
  const [editingFields, setEditingFields] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const depts = ["全部", ...Array.from(new Set(mockEmployees.map((e) => e.dept)))];

  const filteredEmployees = mockEmployees.filter((e) => {
    const matchSearch =
      !search ||
      [e.name, e.empNo, e.dept, e.title].join(" ").toLowerCase().includes(search.toLowerCase());
    const matchDept = deptFilter === "全部" || e.dept === deptFilter;
    return matchSearch && matchDept;
  });

  const selected = mockEmployees.find((e) => e.id === selectedId);
  const docFields =
    selected
      ? (docFieldsByEmployee[selected.id]?.[tabFieldsKey[docTab]] ?? [])
      : [];

  const notifications = selected ? (mockNotifications[selected.id] ?? []) : [];

  const getFieldValue = (label: string, defaultValue: string) =>
    editingFields[`${selectedId}-${docTab}-${label}`] ?? defaultValue;

  const handleFieldEdit = (label: string, value: string) => {
    setEditingFields((prev) => ({
      ...prev,
      [`${selectedId}-${docTab}-${label}`]: value,
    }));
  };

  const handleSaveField = (label: string) => {
    setEditingKey(null);
    toast.success(`字段"${label}"已保存`);
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">员工入职归档 & 花名册</h1>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: Employee Roster */}
        <div className="flex w-[30%] flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3 space-y-2">
            {/* Search */}
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索姓名/工号…"
                className="flex-1 bg-transparent text-xs outline-none placeholder-gray-400"
              />
            </div>
            {/* Dept filter */}
            <div className="flex gap-1.5 flex-wrap">
              {depts.map((d) => (
                <button
                  key={d}
                  onClick={() => setDeptFilter(d)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    deptFilter === d
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">姓名</th>
                  <th className="px-2 py-2 text-left font-medium">部门/岗位</th>
                  <th className="px-2 py-2 text-left font-medium">合同到期</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredEmployees.map((emp) => {
                  const days = contractDaysLeft(emp.contractExpiry);
                  const isExpiringSoon = days <= 60;
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => setSelectedId(emp.id)}
                      className={cn(
                        "cursor-pointer transition-colors",
                        selectedId === emp.id ? "bg-blue-50" : "hover:bg-gray-50",
                      )}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
                            {emp.name[0]}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">{emp.name}</p>
                            <p className="text-gray-400">{emp.empNo}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <p className="text-gray-700">{emp.dept}</p>
                        <p className="text-gray-400">{emp.title}</p>
                      </td>
                      <td className="px-2 py-3">
                        <div>
                          <p className="text-gray-500">{emp.contractExpiry}</p>
                          {isExpiringSoon && (
                            <span className={cn("mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-xs font-medium", daysColor(days))}>
                              {daysLabel(days)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Center: Document Archive */}
        <div className="flex w-[40%] flex-col border-r border-gray-200 bg-white">
          {selected && (
            <>
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-900">{selected.name}</span>
                  <span className="text-xs text-gray-400">{selected.empNo} · {selected.dept}</span>
                </div>
                <p className="mt-0.5 text-xs text-gray-400">入职日期：{selected.hireDate}</p>
              </div>

              {/* Doc tabs */}
              <div className="flex border-b border-gray-100">
                {(["id", "edu", "contract"] as DocTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDocTab(tab)}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium transition-colors",
                      docTab === tab
                        ? "border-b-2 border-blue-600 text-blue-600"
                        : "text-gray-500 hover:text-gray-700",
                    )}
                  >
                    {tabLabels[tab]}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {/* File thumbnail placeholder */}
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                    <div className="text-center">
                      <FileText className="mx-auto h-6 w-6 text-gray-300" />
                      <p className="mt-1 text-xs text-gray-300">扫描件</p>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-700">
                      {selected.name}_{tabLabels[docTab]}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      OCR 已识别 · {docFields.length} 个字段
                    </p>
                    <button
                      onClick={() => toast.info("上传新版本（模拟）")}
                      className="mt-2 flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      上传新版本
                    </button>
                  </div>
                </div>

                {/* OCR Fields */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500">OCR 提取字段</p>
                  <div className="grid grid-cols-1 gap-2">
                    {docFields.map((field) => {
                      const fieldKey = `${selectedId}-${docTab}-${field.label}`;
                      const isEditing = editingKey === fieldKey;
                      const currentValue = getFieldValue(field.label, field.value);
                      return (
                        <div
                          key={field.label}
                          className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                        >
                          <span className="w-24 shrink-0 text-xs text-gray-400">{field.label}</span>
                          {isEditing ? (
                            <input
                              autoFocus
                              value={currentValue}
                              onChange={(e) => handleFieldEdit(field.label, e.target.value)}
                              onBlur={() => handleSaveField(field.label)}
                              onKeyDown={(e) => e.key === "Enter" && handleSaveField(field.label)}
                              className="flex-1 rounded border border-blue-300 bg-white px-2 py-0.5 text-xs text-gray-700 outline-none"
                            />
                          ) : (
                            <span
                              className="flex-1 text-xs font-medium text-gray-700"
                              onClick={() => setEditingKey(fieldKey)}
                            >
                              {currentValue}
                            </span>
                          )}
                          <button
                            onClick={() => setEditingKey(isEditing ? null : fieldKey)}
                            className="text-gray-300 hover:text-gray-600"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Expiry Reminder Panel */}
        <div className="flex w-[30%] flex-col bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-gray-700">到期提醒</span>
            </div>
            {selected && (
              <p className="mt-0.5 text-xs text-gray-400">{selected.name} · {selected.dept}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Expiry items */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">证件 & 合同到期</p>
              <div className="space-y-2">
                {notifications.map((n, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800">{n.docType}</p>
                        <p className="mt-0.5 text-xs text-gray-400">到期：{n.expiry}</p>
                      </div>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", daysColor(n.daysLeft))}>
                        {daysLabel(n.daysLeft)}
                      </span>
                    </div>

                    {/* Notification settings */}
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">收件人：</span>
                        <span className="text-xs text-gray-600">{n.recipients}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-400">提前通知：</span>
                        <span className="text-xs text-gray-600">{n.advanceDays} 天</span>
                        <button
                          onClick={() => toast.info("修改通知设置（模拟）")}
                          className="ml-auto text-blue-500 hover:text-blue-700 text-xs underline"
                        >
                          修改
                        </button>
                      </div>
                    </div>

                    {n.daysLeft <= 60 && (
                      <button
                        onClick={() => toast.success("续签提醒已发送（模拟）")}
                        className="mt-2 w-full rounded-lg bg-orange-500 py-1.5 text-xs font-medium text-white hover:bg-orange-600"
                      >
                        立即发送续签提醒
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notification Log */}
            <div>
              <p className="mb-2 text-xs font-medium text-gray-500">通知日志</p>
              <div className="space-y-2">
                {mockLogs.map((log, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-50 bg-gray-50 p-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                      <div>
                        <p className="text-xs text-gray-700">{log.event}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {log.date} · 发送至：{log.recipient}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
