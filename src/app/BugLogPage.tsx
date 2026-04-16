import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  GitBranch,
  Link2,
  Plus,
  TrendingDown,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

// ─── Mock Data ────────────────────────────────────────────────────────────────

interface LogFile {
  id: string;
  deviceId: string;
  uploadTime: string;
  fileSize: string;
  hasAnomaly: boolean;
}

interface ErrorCode {
  code: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  trend: "up" | "down" | "stable";
}

interface LogAnalysis {
  logId: string;
  deviceId: string;
  timeRange: string;
  errors: ErrorCode[];
  aiRootCause: string;
  responsibility: Array<{ label: string; color: string }>;
}

interface VersionRecord {
  id: string;
  date: string;
  version: string;
  module: string;
  summary: string;
  anomalyCount: number;
}

const logFiles: LogFile[] = [
  { id: "LOG-001", deviceId: "DEV-C3P0-A1", uploadTime: "2026-04-16 09:23", fileSize: "2.4 MB", hasAnomaly: true },
  { id: "LOG-002", deviceId: "DEV-R2D2-B2", uploadTime: "2026-04-15 17:51", fileSize: "1.8 MB", hasAnomaly: true },
  { id: "LOG-003", deviceId: "DEV-BB8-C3", uploadTime: "2026-04-14 11:05", fileSize: "3.1 MB", hasAnomaly: false },
];

const logAnalyses: Record<string, LogAnalysis> = {
  "LOG-001": {
    logId: "LOG-001",
    deviceId: "DEV-C3P0-A1",
    timeRange: "2026-04-15 08:00 ~ 2026-04-16 09:00",
    errors: [
      { code: "ERR_SENSOR_TIMEOUT", frequency: 47, firstSeen: "04-15 08:12", lastSeen: "04-16 08:55", trend: "up" },
      { code: "ERR_BLE_DISCONNECT", frequency: 22, firstSeen: "04-15 09:30", lastSeen: "04-16 07:44", trend: "stable" },
      { code: "ERR_DATA_OVERFLOW", frequency: 9, firstSeen: "04-15 14:00", lastSeen: "04-15 23:12", trend: "down" },
      { code: "WARN_BATTERY_LOW", frequency: 5, firstSeen: "04-16 06:00", lastSeen: "04-16 08:58", trend: "up" },
    ],
    aiRootCause:
      "传感器超时错误频率持续上升，结合 BLE 断连模式，初步判断为固件驱动层与传感器通信时序存在竞态条件，在高负载场景下触发缓冲区溢出。",
    responsibility: [
      { label: "软件", color: "bg-blue-50 text-blue-700" },
      { label: "硬件", color: "bg-rose-50 text-rose-700" },
    ],
  },
  "LOG-002": {
    logId: "LOG-002",
    deviceId: "DEV-R2D2-B2",
    timeRange: "2026-04-14 18:00 ~ 2026-04-15 17:45",
    errors: [
      { code: "ERR_MOTOR_STALL", frequency: 31, firstSeen: "04-14 20:05", lastSeen: "04-15 16:50", trend: "up" },
      { code: "ERR_CALIBRATION_FAIL", frequency: 18, firstSeen: "04-14 18:30", lastSeen: "04-15 12:00", trend: "down" },
      { code: "ERR_OVERHEAT_WARN", frequency: 7, firstSeen: "04-15 10:00", lastSeen: "04-15 15:30", trend: "stable" },
    ],
    aiRootCause:
      "电机堵转错误集中在夜间低温时段，结合校准失败日志，判断为低温环境下润滑脂黏度增大，导致启动扭矩不足触发堵转保护，建议检查配置参数温度补偿设置。",
    responsibility: [
      { label: "配置", color: "bg-amber-50 text-amber-700" },
      { label: "硬件", color: "bg-rose-50 text-rose-700" },
    ],
  },
  "LOG-003": {
    logId: "LOG-003",
    deviceId: "DEV-BB8-C3",
    timeRange: "2026-04-13 22:00 ~ 2026-04-14 11:00",
    errors: [],
    aiRootCause: "日志文件未发现异常错误码，设备运行状态良好，各模块功能正常。",
    responsibility: [],
  },
};

const versionRecords: VersionRecord[] = [
  { id: "v1", date: "2026-04-14", version: "v2.4.1", module: "传感器驱动", summary: "优化传感器采样频率，增加超时重试机制", anomalyCount: 8 },
  { id: "v2", date: "2026-04-10", version: "v2.4.0", module: "BLE 协议栈", summary: "升级 BLE 5.0 支持，调整连接参数", anomalyCount: 3 },
  { id: "v3", date: "2026-04-05", version: "v2.3.9", module: "电机控制", summary: "新增低温启动补偿逻辑，修复堵转检测阈值", anomalyCount: 6 },
  { id: "v4", date: "2026-03-28", version: "v2.3.8", module: "系统核心", summary: "内存管理优化，修复缓冲区越界潜在问题", anomalyCount: 2 },
  { id: "v5", date: "2026-03-20", version: "v2.3.7", module: "UI / 配置", summary: "用户配置界面重构，新增温度补偿参数入口", anomalyCount: 1 },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <ArrowUp className="h-4 w-4 text-rose-500" />;
  if (trend === "down") return <ArrowDown className="h-4 w-4 text-emerald-500" />;
  return <ArrowRight className="h-4 w-4 text-slate-400" />;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BugLogPage() {
  const [selectedLogId, setSelectedLogId] = useState<string>("LOG-001");
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>(versionRecords);
  const [newVersion, setNewVersion] = useState({ date: "", version: "", module: "", summary: "" });
  const [isUploading, setIsUploading] = useState(false);

  const selectedLog = logFiles.find((l) => l.id === selectedLogId) ?? logFiles[0];
  const analysis = logAnalyses[selectedLogId];

  const kpis = [
    { label: "已处理日志数", value: "128", helper: "本月累计", icon: FileText, color: "text-blue-600" },
    {
      label: "今日异常数",
      value: "14",
      trend: "up" as const,
      helper: "较昨日 +3",
      icon: AlertTriangle,
      color: "text-rose-600",
    },
    { label: "本周最频发错误码", value: "ERR_SENSOR_TIMEOUT", helper: "出现 47 次", icon: Bug, color: "text-amber-600" },
    { label: "未解决问题数", value: "7", helper: "需跟进处理", icon: GitBranch, color: "text-slate-600" },
  ];

  const handleUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      toast.success("日志文件上传成功，AI 分析已启动");
    }, 1500);
  };

  const handleLinkVersion = () => {
    toast.info("已关联最近 3 个版本变更记录");
  };

  const handleAddVersion = () => {
    if (!newVersion.date || !newVersion.version || !newVersion.module || !newVersion.summary) {
      toast.error("请填写完整版本信息");
      return;
    }
    const record: VersionRecord = {
      id: `v${Date.now()}`,
      date: newVersion.date,
      version: newVersion.version,
      module: newVersion.module,
      summary: newVersion.summary,
      anomalyCount: 0,
    };
    setVersions((prev) => [record, ...prev]);
    setNewVersion({ date: "", version: "", module: "", summary: "" });
    setShowAddVersion(false);
    toast.success("版本记录已新增");
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white">
          <Bug className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">软件 BUG 日志分析</h1>
          <p className="text-sm text-slate-500">AI 异常根因分析 · 版本变更追踪</p>
        </div>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">{kpi.label}</span>
              <kpi.icon className={cn("h-5 w-5", kpi.color)} />
            </div>
            <div className="mt-3 flex items-end gap-2">
              <span className="text-2xl font-bold leading-none text-slate-900">{kpi.value}</span>
              {kpi.trend === "up" && <TrendingUp className="mb-0.5 h-4 w-4 text-rose-500" />}
              {kpi.trend === "down" && <TrendingDown className="mb-0.5 h-4 w-4 text-emerald-500" />}
            </div>
            <div className="mt-2 text-xs text-slate-400">{kpi.helper}</div>
          </div>
        ))}
      </div>

      {/* Three-column layout */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[25%_45%_30%]">
        {/* Left: Log File List */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">日志文件列表</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{logFiles.length} 个文件</span>
          </div>

          <div className="space-y-3">
            {logFiles.map((log) => (
              <button
                key={log.id}
                type="button"
                onClick={() => setSelectedLogId(log.id)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  selectedLogId === log.id
                    ? "border-blue-200 bg-blue-50"
                    : "border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-slate-100",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{log.deviceId}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      log.hasAnomaly ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {log.hasAnomaly ? "发现异常" : "正常"}
                  </span>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                  <div>{log.uploadTime}</div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {log.fileSize}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100 disabled:opacity-60"
          >
            {isUploading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                上传中…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                上传日志文件
              </>
            )}
          </button>
        </div>

        {/* Center: AI Analysis */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <Bug className="h-4 w-4 text-blue-600" />
              <h2 className="font-semibold text-slate-800">AI 异常分析</h2>
            </div>
            {analysis && (
              <div className="mt-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{analysis.deviceId}</span>
                <span className="mx-2 text-slate-300">|</span>
                {analysis.timeRange}
              </div>
            )}
          </div>

          {analysis && analysis.errors.length > 0 ? (
            <>
              {/* Error Code Table */}
              <div className="mb-5 overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500">
                      <th className="px-4 py-3 text-left font-medium">错误码</th>
                      <th className="px-3 py-3 text-center font-medium">频次</th>
                      <th className="px-3 py-3 text-center font-medium">首次出现</th>
                      <th className="px-3 py-3 text-center font-medium">末次出现</th>
                      <th className="px-3 py-3 text-center font-medium">趋势</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {analysis.errors.map((err) => (
                      <tr key={err.code} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-800">{err.code}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                            {err.frequency}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-slate-500">{err.firstSeen}</td>
                        <td className="px-3 py-3 text-center text-xs text-slate-500">{err.lastSeen}</td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex justify-center">
                            <TrendIcon trend={err.trend} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* AI Root Cause Card */}
              <div className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-slate-50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Bug className="h-3 w-3" />
                  </div>
                  <span className="text-sm font-semibold text-blue-800">AI 根因分析</span>
                </div>
                <p className="text-sm leading-7 text-slate-700">{analysis.aiRootCause}</p>
                {analysis.responsibility.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">可能责任范围：</span>
                    {analysis.responsibility.map((r) => (
                      <span key={r.label} className={cn("rounded-full px-3 py-1 text-xs font-medium", r.color)}>
                        {r.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleLinkVersion}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                <Link2 className="h-4 w-4" />
                关联最近版本变更
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 py-16">
              <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-400" />
              <p className="text-sm font-medium text-slate-600">未发现异常错误码</p>
              <p className="mt-1 text-xs text-slate-400">设备运行状态正常</p>
            </div>
          )}
        </div>

        {/* Right: Version Change Log */}
        <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-slate-600" />
              <h2 className="font-semibold text-slate-800">版本变更日志</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAddVersion((v) => !v)}
              className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {showAddVersion ? <ChevronUp className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              新增版本记录
            </button>
          </div>

          {/* Inline Add Form */}
          {showAddVersion && (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-700">新增版本记录</span>
                <button type="button" onClick={() => setShowAddVersion(false)}>
                  <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={newVersion.date}
                    onChange={(e) => setNewVersion((v) => ({ ...v, date: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                    placeholder="发版日期"
                  />
                  <input
                    value={newVersion.version}
                    onChange={(e) => setNewVersion((v) => ({ ...v, version: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                    placeholder="版本号 (如 v2.5.0)"
                  />
                </div>
                <input
                  value={newVersion.module}
                  onChange={(e) => setNewVersion((v) => ({ ...v, module: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                  placeholder="变更模块"
                />
                <textarea
                  value={newVersion.summary}
                  onChange={(e) => setNewVersion((v) => ({ ...v, summary: e.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
                  placeholder="变更内容摘要"
                />
                <button
                  type="button"
                  onClick={handleAddVersion}
                  className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  确认新增
                </button>
              </div>
            </div>
          )}

          {/* Version Table */}
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
            {versions.map((ver) => (
              <div
                key={ver.id}
                className={cn(
                  "rounded-xl border p-4",
                  ver.anomalyCount > 5
                    ? "border-orange-200 bg-orange-50"
                    : "border-slate-100 bg-slate-50",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-white">
                        {ver.version}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{ver.module}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">{ver.summary}</p>
                    <div className="mt-2 text-xs text-slate-400">{ver.date}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-bold",
                        ver.anomalyCount > 5
                          ? "bg-orange-200 text-orange-800"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {ver.anomalyCount} 异常
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
