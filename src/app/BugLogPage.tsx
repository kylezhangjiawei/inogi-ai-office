import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bug,
  CheckCircle2,
  ChevronUp,
  FileText,
  GitBranch,
  Link2,
  Plus,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Textarea } from "./components/ui/textarea";
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
  const trendConfig = {
    up: { Icon: ArrowUp, label: "上升", className: "text-rose-600" },
    down: { Icon: ArrowDown, label: "下降", className: "text-emerald-600" },
    stable: { Icon: ArrowRight, label: "稳定", className: "text-slate-500" },
  } as const;
  const { Icon, label, className } = trendConfig[trend];

  return (
    <span className={cn("inline-flex items-center justify-center", className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BugLogPage() {
  const [selectedLogId, setSelectedLogId] = useState<string>("LOG-001");
  const [showAddVersion, setShowAddVersion] = useState(false);
  const [versions, setVersions] = useState<VersionRecord[]>(versionRecords);
  const [newVersion, setNewVersion] = useState({ date: "", version: "", module: "", summary: "" });
  const [versionError, setVersionError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const analysis = logAnalyses[selectedLogId];

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

  const handleAddVersion = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newVersion.date || !newVersion.version || !newVersion.module || !newVersion.summary) {
      setVersionError("请填写完整的发版日期、版本号、变更模块和变更摘要。");
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
    setVersionError("");
    setShowAddVersion(false);
    toast.success("版本记录已新增");
  };

  const updateVersionField = (field: keyof typeof newVersion, value: string) => {
    setNewVersion((current) => ({ ...current, [field]: value }));
    if (versionError) setVersionError("");
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={Bug}
        eyebrow="软件质量 / 异常诊断"
        title="软件 BUG 日志分析"
        description="聚合设备运行日志、AI 根因判断与版本变更记录，缩短异常定位路径。"
        meta={
          <span role="status" aria-live="polite">
            {isUploading ? "日志上传中，完成后将自动启动 AI 分析。" : `已载入 ${logFiles.length} 份设备日志`}
          </span>
        }
        actions={
          <Button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            aria-busy={isUploading}
            className="hz-primary-action"
          >
            {isUploading ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white motion-reduce:animate-none"
                  aria-hidden="true"
                />
                上传中…
              </>
            ) : (
              <>
                <Upload aria-hidden="true" />
                上传日志文件
              </>
            )}
          </Button>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileText} label="已处理日志数" value="128" note="本月累计" tone="brand" />
        <HorizonMetric
          Icon={AlertTriangle}
          label="今日异常数"
          value={
            <span className="inline-flex items-center gap-1.5">
              14
              <TrendingUp className="size-4 text-rose-600" aria-hidden="true" />
              <span className="sr-only">较昨日上升</span>
            </span>
          }
          note="较昨日 +3"
          tone="danger"
        />
        <HorizonMetric
          Icon={Bug}
          label="本周最频发错误码"
          value={<span className="block break-all font-mono text-sm sm:text-base">ERR_SENSOR_TIMEOUT</span>}
          note="出现 47 次"
          tone="warning"
        />
        <HorizonMetric Icon={GitBranch} label="未解决问题数" value="7" note="需跟进处理" tone="neutral" />
      </HorizonMetricGrid>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={FileText}
            title="日志文件"
            description="选择设备日志查看诊断结果"
            trailing={
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 tabular-nums">
                {logFiles.length} 份
              </span>
            }
          />
          <div className="space-y-2 p-3">
            {logFiles.map((log) => {
              const isSelected = selectedLogId === log.id;
              return (
                <Button variant="unstyled"
                  key={log.id}
                  type="button"
                  onClick={() => setSelectedLogId(log.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full rounded-xl border p-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2",
                    isSelected
                      ? "border-primary/25 bg-accent"
                      : "border-slate-200 bg-white hover:border-primary/20 hover:bg-slate-50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("text-sm font-semibold", isSelected ? "text-primary" : "text-slate-800")}>
                      {log.deviceId}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                        log.hasAnomaly ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
                      )}
                    >
                      {log.hasAnomaly ? "发现异常" : "正常"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    <time className="block tabular-nums">{log.uploadTime}</time>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      {log.fileSize}
                    </span>
                  </div>
                </Button>
              );
            })}
          </div>
        </section>

        <section className="hz-surface min-w-0 overflow-hidden xl:min-h-[34rem]">
          <HorizonSectionHeader
            Icon={Bug}
            title="AI 异常分析"
            description={analysis ? `${analysis.deviceId} · ${analysis.timeRange}` : "选择一份日志开始分析"}
          />

          {analysis && analysis.errors.length > 0 ? (
            <div className="p-4 sm:p-5">
              <div className="material-scrollbar overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[600px] text-sm">
                  <caption className="sr-only">{analysis.deviceId} 的异常错误码、出现频次、时间范围和变化趋势</caption>
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-600">
                      <th scope="col" className="px-4 py-3 text-left font-semibold">错误码</th>
                      <th scope="col" className="px-3 py-3 text-center font-semibold">频次</th>
                      <th scope="col" className="px-3 py-3 text-center font-semibold">首次出现</th>
                      <th scope="col" className="px-3 py-3 text-center font-semibold">末次出现</th>
                      <th scope="col" className="px-3 py-3 text-center font-semibold">趋势</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysis.errors.map((err) => (
                      <tr key={err.code} className="hover:bg-slate-50/80">
                        <th scope="row" className="px-4 py-3 text-left font-mono text-xs font-semibold text-slate-800">
                          {err.code}
                        </th>
                        <td className="px-3 py-3 text-center tabular-nums">
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700">
                            {err.frequency}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-slate-500 tabular-nums">{err.firstSeen}</td>
                        <td className="px-3 py-3 text-center text-xs text-slate-500 tabular-nums">{err.lastSeen}</td>
                        <td className="px-3 py-3 text-center"><TrendIcon trend={err.trend} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 rounded-xl border border-primary/10 bg-[#f7f9ff] p-4 sm:p-5">
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white" aria-hidden="true">
                    <Bug className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-sm font-semibold text-[#1b2559]">AI 根因判断</h3>
                </div>
                <p className="text-pretty text-sm leading-7 text-slate-700">{analysis.aiRootCause}</p>
                {analysis.responsibility.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">可能责任范围</span>
                    {analysis.responsibility.map((responsibility) => (
                      <span
                        key={responsibility.label}
                        className={cn("rounded-full px-3 py-1 text-xs font-medium", responsibility.color)}
                      >
                        {responsibility.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleLinkVersion}
                className="mt-4 w-full rounded-xl border-primary/20 text-primary hover:bg-accent hover:text-primary"
              >
                <Link2 aria-hidden="true" />
                关联最近版本变更
              </Button>
            </div>
          ) : (
            <HorizonEmptyState
              Icon={CheckCircle2}
              title="未发现异常错误码"
              description="当前设备运行状态正常，可继续查看其他日志或上传新的日志文件。"
            />
          )}
        </section>

        <section className="hz-surface min-w-0 overflow-hidden xl:col-span-2 2xl:col-span-1">
          <HorizonSectionHeader
            Icon={GitBranch}
            title="版本变更日志"
            description="将异常波动与近期发版记录放在同一时间线上核对"
            trailing={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddVersion((current) => !current);
                  setVersionError("");
                }}
                aria-expanded={showAddVersion}
                aria-controls="add-version-form"
                className="border-slate-200 text-slate-700"
              >
                {showAddVersion ? <ChevronUp aria-hidden="true" /> : <Plus aria-hidden="true" />}
                新增版本
              </Button>
            }
          />

          {showAddVersion && (
            <form
              id="add-version-form"
              className="m-3 rounded-xl border border-primary/15 bg-[#f7f9ff] p-4"
              onSubmit={handleAddVersion}
              noValidate
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#1b2559]">新增版本记录</h3>
                  <p className="mt-1 text-xs text-slate-500">记录本次发版内容，便于后续异常关联。</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowAddVersion(false);
                    setVersionError("");
                  }}
                  aria-label="关闭新增版本表单"
                  className="h-8 w-8 text-slate-500"
                >
                  <X aria-hidden="true" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="version-date">发版日期</Label>
                  <Input
                    id="version-date"
                    name="date"
                    type="date"
                    value={newVersion.date}
                    onChange={(event) => updateVersionField("date", event.target.value)}
                    aria-required="true"
                    aria-invalid={Boolean(versionError && !newVersion.date)}
                    aria-describedby={versionError ? "version-form-error" : undefined}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="version-number">版本号</Label>
                  <Input
                    id="version-number"
                    name="version"
                    value={newVersion.version}
                    onChange={(event) => updateVersionField("version", event.target.value)}
                    placeholder="例如 v2.5.0"
                    aria-required="true"
                    aria-invalid={Boolean(versionError && !newVersion.version)}
                    aria-describedby={versionError ? "version-form-error" : undefined}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2 2xl:col-span-1">
                  <Label htmlFor="version-module">变更模块</Label>
                  <Input
                    id="version-module"
                    name="module"
                    value={newVersion.module}
                    onChange={(event) => updateVersionField("module", event.target.value)}
                    placeholder="例如传感器驱动"
                    aria-required="true"
                    aria-invalid={Boolean(versionError && !newVersion.module)}
                    aria-describedby={versionError ? "version-form-error" : undefined}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2 2xl:col-span-1">
                  <Label htmlFor="version-summary">变更摘要</Label>
                  <Textarea
                    id="version-summary"
                    name="summary"
                    value={newVersion.summary}
                    onChange={(event) => updateVersionField("summary", event.target.value)}
                    rows={3}
                    placeholder="简要说明本次版本变更内容"
                    aria-required="true"
                    aria-invalid={Boolean(versionError && !newVersion.summary)}
                    aria-describedby={versionError ? "version-form-error" : undefined}
                    className="bg-white"
                  />
                </div>
              </div>

              {versionError && (
                <p id="version-form-error" role="alert" className="mt-3 text-sm font-medium text-rose-700">
                  {versionError}
                </p>
              )}

              <Button type="submit" className="hz-primary-action mt-4 w-full sm:w-auto">
                确认新增
              </Button>
            </form>
          )}

          <div className="grid gap-2 p-3 sm:grid-cols-2 2xl:grid-cols-1">
            {versions.map((versionRecord) => (
              <article
                key={versionRecord.id}
                className={cn(
                  "rounded-xl border p-4",
                  versionRecord.anomalyCount > 5
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-white",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[#1b2559] px-2 py-0.5 font-mono text-xs font-bold text-white">
                        {versionRecord.version}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {versionRecord.module}
                      </span>
                    </div>
                    <p className="mt-2 text-pretty text-xs leading-5 text-slate-600">{versionRecord.summary}</p>
                    <time className="mt-2 block text-xs text-slate-500 tabular-nums">{versionRecord.date}</time>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                      versionRecord.anomalyCount > 5
                        ? "bg-amber-200 text-amber-900"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {versionRecord.anomalyCount} 异常
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
