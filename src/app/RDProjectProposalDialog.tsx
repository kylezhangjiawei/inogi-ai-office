import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { cn } from "./components/ui/utils";
import { usePermission } from "./hooks/usePermission";
import { toast } from "sonner";
import {
  ApprovalNode,
  getActiveFlow,
  getPoolForPermission,
  MOCK_USERS_BY_PERMISSION,
} from "./lib/approvalFlowConfig";
import { AuditActor, recordAudit } from "./lib/auditLog";
import { PERMISSIONS } from "./lib/permissions";

// ─── Types ───────────────────────────────────────────────────────────────────

export type UserRole = "user" | "admin" | "director";
type Priority = "high" | "medium" | "low";
type Step = 1 | 2 | 3 | 4;

type ProposedTask = {
  id: string;
  title: string;
  description?: string;
  owner: string;
  owner_reason: string;
  collaborators: string[];
  due_date: string;
  priority: Priority;
  category_path: string;
  estimated_days: number;
  duration_basis: string;
};

type ParentProjectOption = {
  id: string;
  label: string;
  task_count: number;
};

// ─── Demo data (mock) ────────────────────────────────────────────────────────

const EXISTING_PROJECTS: ParentProjectOption[] = [
  { id: "prj-001", label: "电磁阀工艺升级 (v2.1)", task_count: 12 },
  { id: "prj-002", label: "OC-10 制氧机量产准备", task_count: 28 },
  { id: "prj-003", label: "电池组 510K 申报", task_count: 9 },
  { id: "prj-004", label: "车充 EMC 整改", task_count: 6 },
];

/**
 * Returns the approval nodes applicable to this user role.
 * - director: no review nodes (can direct-dispatch)
 * - admin: skips the L1 review (only L2+ left)
 * - user: all nodes from configured flow
 */
function getApplicableNodes(userRole: UserRole): ApprovalNode[] {
  const flow = getActiveFlow("project_proposal");
  if (userRole === "director") return [];
  if (userRole === "admin") {
    // Admins skip review-l1 (they ARE the L1 reviewers), only L2+ apply
    return flow.nodes.filter((n) => n.permission_code !== "rd-project:review-l1");
  }
  return flow.nodes;
}

const MODE_LABEL: Record<"single" | "any" | "all", { label: string; text: string; bg: string }> = {
  single: { label: "单人审", text: "text-slate-700", bg: "bg-slate-100" },
  any: { label: "任一审", text: "text-blue-700", bg: "bg-blue-100" },
  all: { label: "全员审", text: "text-violet-700", bg: "bg-violet-100" },
};

const PROPOSAL_ACTORS: Record<UserRole, AuditActor> = {
  user: { id: "u-current", name: "我", role: "研发成员" },
  admin: { id: "u-li-li", name: "李立", role: "研发管理员" },
  director: { id: "u-wang-zy", name: "王志远", role: "厂长" },
};

function createProposalId(): string {
  return `PRJ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

// ─── AI Mock Parser ──────────────────────────────────────────────────────────

/** Generate 3-4 mock tasks based on keywords in description. */
function mockAiParse(_title: string, description: string): ProposedTask[] {
  const text = description.toLowerCase();
  const seed = Date.now();
  const baseDate = new Date(2026, 4, 14); // 2026-05-14
  const dateAfter = (days: number) =>
    new Date(baseDate.getTime() + days * 86400000).toISOString().slice(0, 10);

  // Detect domain
  let domain: "valve" | "battery" | "oc" | "charger" | "generic" = "generic";
  if (/电磁阀|阀/.test(text)) domain = "valve";
  else if (/电池|寿命|充放电/.test(text)) domain = "battery";
  else if (/制氧|氧浓度|分子筛|压力/.test(text)) domain = "oc";
  else if (/车充|emc|快充|电源/.test(text)) domain = "charger";

  const templates: Record<typeof domain, ProposedTask[]> = {
    valve: [
      {
        id: `t-${seed}-1`, title: "电磁阀温升测试方案制定", description: "依据 510K 要求制定温升测试方案，覆盖额定/超载/低温工况",
        owner: "王磊", owner_reason: "按规则 A5.3：硬件/电磁阀/测试类 → 硬件测试工程师 · 王磊当前负载 5/8",
        collaborators: ["陈静"], due_date: dateAfter(7), priority: "high",
        category_path: "310阀系统 / 310电磁阀 / 测试类", estimated_days: 5,
        duration_basis: "参考 RD-2023-118 / RD-2024-076 同类温升测试均值",
      },
      {
        id: `t-${seed}-2`, title: "电磁阀 BOM 影响评估", description: "评估新工艺对 BOM 的影响项，输出变更清单",
        owner: "刘华", owner_reason: "按规则：BOM 变更 → 项目工程师 · 刘华当前 6/8",
        collaborators: ["王磊"], due_date: dateAfter(4), priority: "medium",
        category_path: "310阀系统 / 310电磁阀 / 文档类", estimated_days: 3,
        duration_basis: "BOM 评估历史均值 2.5 天，含一轮评审",
      },
      {
        id: `t-${seed}-3`, title: "电磁阀寿命测试夹具准备", description: "采购 / 调试寿命测试夹具，准备测试环境",
        owner: "赵强", owner_reason: "按规则：测试夹具 → 工艺工程师 · 赵强当前 2/8",
        collaborators: [], due_date: dateAfter(10), priority: "medium",
        category_path: "310阀系统 / 310电磁阀 / 工艺类", estimated_days: 4,
        duration_basis: "夹具采购周期 + 调试 1 天",
      },
    ],
    battery: [
      {
        id: `t-${seed}-1`, title: "电池循环寿命测试", description: "完成 500 次循环测试，输出衰减曲线",
        owner: "王磊", owner_reason: "按规则：电池/寿命/测试类 → 硬件测试工程师 · 王磊",
        collaborators: ["陈静"], due_date: dateAfter(14), priority: "high",
        category_path: "电源部分 / 电池 / 测试类", estimated_days: 14,
        duration_basis: "循环寿命测试固定 14 天工期",
      },
      {
        id: `t-${seed}-2`, title: "低温放电曲线采集", description: "-10°C 环境放电曲线采集，验证低温性能",
        owner: "陈静", owner_reason: "按规则：低温测试 → 质检员 · 陈静",
        collaborators: ["王磊"], due_date: dateAfter(7), priority: "high",
        category_path: "电源部分 / 电池 / 测试类", estimated_days: 5,
        duration_basis: "低温箱预约 + 测试 3 天",
      },
      {
        id: `t-${seed}-3`, title: "电池规格书更新", description: "依据测试结果更新规格书",
        owner: "李静", owner_reason: "按规则：规格书 → 法规工程师 · 李静（注意：请假中，复岗后开始）",
        collaborators: [], due_date: dateAfter(20), priority: "medium",
        category_path: "电源部分 / 电池 / 文档类", estimated_days: 3,
        duration_basis: "规格书更新历史均值 3 天",
      },
    ],
    oc: [
      {
        id: `t-${seed}-1`, title: "OC-10 压力传感器标定", description: "对 OC-10 压力传感器进行多点标定",
        owner: "王磊", owner_reason: "按规则：制氧机/压力/测试类 → 硬件测试工程师",
        collaborators: ["陈静"], due_date: dateAfter(10), priority: "high",
        category_path: "储气系统 / 压力模块 / 测试类", estimated_days: 6,
        duration_basis: "标定流程 + 双向复测",
      },
      {
        id: `t-${seed}-2`, title: "氧浓度稳定性测试", description: "8 小时连续工作氧浓度稳定性验证",
        owner: "陈静", owner_reason: "按规则：氧浓度测试 → 质检员",
        collaborators: [], due_date: dateAfter(5), priority: "medium",
        category_path: "分子筛系统 / 测试类", estimated_days: 3,
        duration_basis: "标准 8 小时连续测试",
      },
      {
        id: `t-${seed}-3`, title: "分子筛性能基线", description: "建立分子筛基线性能参数",
        owner: "赵强", owner_reason: "按规则：分子筛工艺 → 工艺工程师",
        collaborators: [], due_date: dateAfter(8), priority: "medium",
        category_path: "分子筛系统 / 工艺类", estimated_days: 5,
        duration_basis: "首次基线建立 + 复核",
      },
    ],
    charger: [
      {
        id: `t-${seed}-1`, title: "车充 EMC 整改测试", description: "对 EMC 不达标项进行整改并复测",
        owner: "张越", owner_reason: "按规则：EMC → 嵌入式工程师 · 张越",
        collaborators: ["王磊"], due_date: dateAfter(14), priority: "high",
        category_path: "配件系统 / 车充 / 测试类", estimated_days: 10,
        duration_basis: "EMC 整改 + 外部实验室排期",
      },
      {
        id: `t-${seed}-2`, title: "车充电源拓扑评审", description: "组织拓扑评审会议，识别优化点",
        owner: "刘华", owner_reason: "按规则：电源评审 → 项目工程师",
        collaborators: ["张越"], due_date: dateAfter(7), priority: "medium",
        category_path: "配件系统 / 车充 / 文档类", estimated_days: 3,
        duration_basis: "评审准备 + 会议",
      },
    ],
    generic: [
      {
        id: `t-${seed}-1`, title: "需求确认与边界梳理", description: "组织一次需求评审，明确边界",
        owner: "刘华", owner_reason: "按规则：需求评审 → 项目工程师 · 刘华当前 6/8",
        collaborators: [], due_date: dateAfter(3), priority: "high",
        category_path: "待定 / 需明确",
        estimated_days: 2, duration_basis: "标准需求评审 1-2 天",
      },
      {
        id: `t-${seed}-2`, title: "技术方案初稿", description: "撰写技术方案初稿，含可行性分析",
        owner: "王磊", owner_reason: "按规则：技术方案 → 硬件测试工程师（待人工确认是否合适）",
        collaborators: ["张越"], due_date: dateAfter(7), priority: "medium",
        category_path: "待定 / 需明确", estimated_days: 4,
        duration_basis: "方案撰写均值 3-5 天",
      },
      {
        id: `t-${seed}-3`, title: "评审与归档", description: "组织方案评审，归档评审结论",
        owner: "刘华", owner_reason: "按规则：评审 → 项目工程师",
        collaborators: [], due_date: dateAfter(10), priority: "low",
        category_path: "待定 / 文档类", estimated_days: 2,
        duration_basis: "评审 + 归档固定 2 天",
      },
    ],
  };

  return templates[domain];
}

function mockSuggestProject(description: string): string | null {
  const text = description.toLowerCase();
  if (/电磁阀|工艺|阀/.test(text)) return "prj-001";
  if (/制氧|分子筛|压力|氧浓度/.test(text)) return "prj-002";
  if (/电池|寿命/.test(text)) return "prj-003";
  if (/车充|emc/.test(text)) return "prj-004";
  return null;
}

// ─── Avatar helper ───────────────────────────────────────────────────────────

function hashColor(name: string): string {
  const colors = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-pink-500", "bg-cyan-500", "bg-indigo-500", "bg-rose-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function MiniAvatar({ name, size = "sm" }: { name: string; size?: "xs" | "sm" }) {
  const initial = name.replace(/\(.+?\)/g, "").trim().slice(0, 1) || "?";
  const dim = size === "xs" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-xs";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white", dim, hashColor(name))} title={name}>
      {initial}
    </span>
  );
}

const PRIORITY_OPTIONS: { value: Priority; label: string; chip: string }[] = [
  { value: "high", label: "高", chip: "bg-red-50 text-red-700 border-red-100" },
  { value: "medium", label: "中", chip: "bg-amber-50 text-amber-700 border-amber-100" },
  { value: "low", label: "低", chip: "bg-slate-50 text-slate-600 border-slate-100" },
];

// ─── Step 1: Input ───────────────────────────────────────────────────────────

const PROPOSAL_ATTACHMENT_EXTENSIONS = [
  "csv",
  "xlsx",
  "xls",
  "tsv",
  "doc",
  "docx",
  "txt",
  "md",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
];
const PROPOSAL_ATTACHMENT_ACCEPT = PROPOSAL_ATTACHMENT_EXTENSIONS.map((item) => `.${item}`).join(",");
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "tgz"]);
const BROWSER_TEXT_EXTENSIONS = new Set(["csv", "tsv", "txt", "md", "json"]);
const MAX_BROWSER_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 12000;

function attachmentExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index + 1).trim().toLowerCase() : "";
}

function proposalFileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeProposalFiles(current: File[], incoming: File[]) {
  const byKey = new Map(current.map((file) => [proposalFileKey(file), file]));
  for (const file of incoming) {
    byKey.set(proposalFileKey(file), file);
  }
  return Array.from(byKey.values());
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${size} B`;
}

function describeAttachment(file: File) {
  const extension = attachmentExtension(file.name);
  const type = ARCHIVE_EXTENSIONS.has(extension) ? "压缩包" : extension ? extension.toUpperCase() : "文件";
  return `${type} · ${formatAttachmentSize(file.size)}`;
}

async function extractProposalAttachmentText(files: File[]) {
  const chunks = await Promise.all(
    files.map(async (file) => {
      const extension = attachmentExtension(file.name);
      const header = `附件：${file.name}（${formatAttachmentSize(file.size)}）`;
      if (BROWSER_TEXT_EXTENSIONS.has(extension) && file.size <= MAX_BROWSER_TEXT_BYTES) {
        const text = await file.text();
        return `${header}\n${text.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}`;
      }
      if (ARCHIVE_EXTENSIONS.has(extension)) {
        return `${header}\n压缩包已上传，按策略将先解包，再对内部 Excel / Word / PDF / 图片继续解析。`;
      }
      return header;
    }),
  );
  return chunks.filter(Boolean).join("\n\n");
}

function StepInput({
  title,
  setTitle,
  description,
  setDescription,
  files,
  setFiles,
  onNext,
  onClose,
}: {
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  files: File[];
  setFiles: (f: File[]) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const hasDescription = description.trim().length > 0;
  const hasFiles = files.length > 0;
  const canSubmit = hasDescription || hasFiles;

  // Mutual-exclusive mode: when one is filled, the other becomes "disabled-look" (optional supplement)
  // but still editable. Validation only requires ONE of them.
  const descPrimary = hasDescription || !hasFiles; // description is "primary" when active or both empty
  const filesPrimary = hasFiles || !hasDescription;
  const [dragActive, setDragActive] = useState(false);

  const addFiles = (incoming: FileList | File[]) => {
    const incomingFiles = Array.from(incoming).filter((file) => file.size > 0);
    if (!incomingFiles.length) return;
    const nextFiles = mergeProposalFiles(files, incomingFiles);
    setFiles(nextFiles);
    setDragActive(false);
    if (nextFiles.length === files.length) {
      toast.info("文件已在上传列表中");
    }
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files ?? []);
    event.currentTarget.value = "";
  };

  const handleFileDrag = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    addFiles(event.dataTransfer.files);
  };

  return (
    <div className="space-y-4 px-6 py-5">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-700">
          立项标题（可选，AI 会自动生成）
        </label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例：电磁阀工艺升级 v2.1"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Banner: explain the either-or rule */}
      <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-2 text-[11px] text-blue-700">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          <span className="font-semibold">立项描述</span> 与 <span className="font-semibold">附件</span> 二选其一即可，提供任一项 AI 都能开始解析；同时提供则 AI 会综合两者。
        </span>
      </div>

      {/* Description */}
      <div className={cn("transition-opacity", !descPrimary && "opacity-60")}>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-700">
            立项描述
            {hasDescription && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                <CheckCircle2 className="h-3 w-3" />
                已填写
              </span>
            )}
          </label>
          <span className="text-[10px] text-slate-400">
            {hasFiles && !hasDescription ? "可省略（附件已提供）" : "或粘贴文本"}
          </span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="粘贴会议纪要、邮件正文，或直接描述立项目标、范围与关键节点。"
          className="w-full resize-none rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2.5 text-sm leading-relaxed outline-none transition-all focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* OR divider */}
      <div className="relative flex items-center">
        <div className="flex-1 border-t border-dashed border-slate-200" />
        <span className="mx-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          或
        </span>
        <div className="flex-1 border-t border-dashed border-slate-200" />
      </div>

      {/* Attachments */}
      <div className={cn("transition-opacity", !filesPrimary && "opacity-60")}>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-700">
            上传附件
            {hasFiles && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                <CheckCircle2 className="h-3 w-3" />
                已选 {files.length} 个
              </span>
            )}
          </label>
          <span className="text-[10px] text-slate-400">
            {hasDescription && !hasFiles ? "可省略（描述已提供）" : "或拖入文件"}
          </span>
        </div>
        <label
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-3 text-sm transition-all",
            dragActive
              ? "border-blue-400 bg-blue-50 text-blue-700 ring-2 ring-blue-100"
              : "border-slate-300 bg-slate-50/40 text-slate-500 hover:border-blue-300 hover:bg-blue-50/30 hover:text-blue-600",
          )}
          onDragEnter={handleFileDrag}
          onDragOver={handleFileDrag}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        >
          <FileUp className="h-4 w-4" />
          {hasFiles
            ? `已选 ${files.length} 个文件，点击继续添加`
            : "拖入或点击上传 Excel / Word / PDF / 图片"}
          <input
            type="file"
            className="hidden"
            accept={PROPOSAL_ATTACHMENT_ACCEPT}
            multiple
            onChange={handleFileInputChange}
          />
        </label>
        <p className="mt-1.5 text-[10px] text-slate-400">
          支持 Excel / Word / PDF / 图片 / zip、rar、7z 压缩包；拖入后会显示在下方列表。
        </p>
        {hasFiles && (
          <ul className="mt-2 space-y-1">
            {files.map((f, idx) => (
              <li
                key={proposalFileKey(f)}
                className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
              >
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{describeAttachment(f)}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, i) => i !== idx))}
                  className="ml-2 shrink-0 text-slate-400 hover:text-red-500"
                  aria-label="移除"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
        <span className="text-[11px] text-slate-400">
          {canSubmit
            ? hasDescription && hasFiles
              ? "✓ 描述 + 附件 已就绪，AI 将综合两者解析"
              : hasDescription
                ? "✓ 描述已就绪，可继续"
                : "✓ 附件已就绪，可继续"
            : "请提供描述或附件中的任一项"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onNext}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 解析
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Processing ──────────────────────────────────────────────────────

function StepProcessing({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 px-6 py-10">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-200/60" />
        <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_12px_32px_rgba(37,99,235,0.3)]">
          <Sparkles className="h-7 w-7" />
        </span>
      </div>
      <div className="text-center">
        <h3 className="text-base font-semibold text-slate-900">AI 正在解析您的立项</h3>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
      <div className="w-full max-w-xs">
        <div className="h-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-center text-[11px] tabular-nums text-slate-400">{progress}%</div>
      </div>
    </div>
  );
}

// ─── Step 3: Review ──────────────────────────────────────────────────────────

function TaskEditRow({
  task,
  onChange,
  onDelete,
  onRequestAiHelp,
}: {
  task: ProposedTask;
  onChange: (t: ProposedTask) => void;
  onDelete: () => void;
  onRequestAiHelp: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const pCfg = PRIORITY_OPTIONS.find((p) => p.value === task.priority)!;

  return (
    <div className="rounded-lg border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(15,23,42,0.05)]">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label={expanded ? "收起" : "展开"}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-90")} />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            value={task.title}
            onChange={(e) => onChange({ ...task, title: e.target.value })}
            className="w-full rounded border-0 bg-transparent px-0 py-0 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400 focus:bg-slate-50 focus:px-1.5"
            placeholder="任务标题"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500">
            {/* Owner */}
            <span className="flex items-center gap-1.5" title={task.owner_reason}>
              <MiniAvatar name={task.owner} size="xs" />
              <span className="font-medium text-slate-700">{task.owner}</span>
              <span className="cursor-help text-[10px] text-slate-400">ⓘ</span>
            </span>
            <span className="text-slate-300">·</span>
            {/* Due */}
            <span className="tabular-nums">{task.due_date}</span>
            <span className="text-slate-300">·</span>
            {/* Priority */}
            <span className={cn("rounded border px-1.5 py-0.5 font-semibold", pCfg.chip)}>
              {pCfg.label}
            </span>
            <span className="text-slate-300">·</span>
            {/* Duration */}
            <span title={task.duration_basis}>预估 {task.estimated_days} 天</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onRequestAiHelp}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-violet-50 hover:text-violet-600"
            title="请 AI 优化"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50/40 px-3.5 py-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-500">描述</label>
            <textarea
              value={task.description ?? ""}
              onChange={(e) => onChange({ ...task, description: e.target.value })}
              rows={2}
              className="w-full resize-none rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">主责人</label>
              <input
                value={task.owner}
                onChange={(e) => onChange({ ...task, owner: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">截止日期</label>
              <input
                type="date"
                value={task.due_date}
                onChange={(e) => onChange({ ...task, due_date: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">优先级</label>
              <select
                value={task.priority}
                onChange={(e) => onChange({ ...task, priority: e.target.value as Priority })}
                className="w-full cursor-pointer rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">分类路径</label>
              <input
                value={task.category_path}
                onChange={(e) => onChange({ ...task, category_path: e.target.value })}
                className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-100"
              />
            </div>
          </div>
          <div className="rounded border border-blue-100 bg-blue-50/40 px-2.5 py-2 text-[11px] leading-relaxed text-blue-700">
            <span className="font-semibold">AI 推荐理由：</span>
            {task.owner_reason}
            <div className="mt-0.5 text-blue-600/80">工期依据：{task.duration_basis}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepReview({
  title,
  setTitle,
  parentProjectId,
  setParentProjectId,
  newProjectName,
  setNewProjectName,
  tasks,
  setTasks,
  proposalId,
  auditActor,
  onBack,
  onNext,
}: {
  title: string;
  setTitle: (v: string) => void;
  parentProjectId: string | "new";
  setParentProjectId: (v: string | "new") => void;
  newProjectName: string;
  setNewProjectName: (v: string) => void;
  tasks: ProposedTask[];
  setTasks: (t: ProposedTask[]) => void;
  proposalId: string;
  auditActor: AuditActor;
  onBack: () => void;
  onNext: () => void;
}) {
  const addTask = () => {
    const taskId = `t-${Date.now()}`;
    setTasks([
      ...tasks,
      {
        id: taskId,
        title: "新增任务",
        description: "",
        owner: "待指派",
        owner_reason: "人工新增，待规则匹配",
        collaborators: [],
        due_date: "2026-05-30",
        priority: "medium",
        category_path: "待定 / 需明确",
        estimated_days: 3,
        duration_basis: "默认 3 天",
      },
    ]);
    recordAudit({
      actor: auditActor,
      action: "task.created",
      resource: { type: "task", id: taskId, name: "新增任务" },
      comment: "在立项审阅阶段手动追加任务草稿",
      metadata: { proposal_id: proposalId, origin: "manual_draft" },
      source: "web",
    });
  };

  const updateTask = (id: string, t: ProposedTask) => {
    setTasks(tasks.map((x) => (x.id === id ? t : x)));
  };

  const deleteTask = (id: string) => {
    const target = tasks.find((x) => x.id === id);
    setTasks(tasks.filter((x) => x.id !== id));
    if (target) {
      recordAudit({
        actor: auditActor,
        action: "task.edited",
        resource: { type: "task", id: target.id, name: target.title },
        comment: "在立项审阅阶段移除了任务草稿",
        metadata: { proposal_id: proposalId, removed: true },
        source: "web",
      });
    }
  };

  const requestAiHelpForTask = (id: string) => {
    const target = tasks.find((x) => x.id === id);
    recordAudit({
      actor: auditActor,
      action: "ai.regenerated",
      resource: { type: "task", id, name: target?.title ?? "AI 任务建议" },
      comment: "请求 AI 重新优化单条任务建议",
      metadata: { proposal_id: proposalId },
      source: "web",
    });
    toast.success("已请 AI 重新生成该任务建议", { description: "可在结果中继续编辑" });
    // Mock: keep as-is for demo
  };

  const requestAiOptimizeAll = () => {
    recordAudit({
      actor: auditActor,
      action: "ai.regenerated",
      resource: { type: "proposal", id: proposalId, name: title || "AI 立项" },
      comment: "请求 AI 重新评估全部任务建议",
      metadata: { task_count: tasks.length },
      source: "web",
    });
    toast.success("AI 已对全部任务重新评估", { description: `刷新了 ${tasks.length} 个任务的责任人 / 工期建议` });
  };

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="space-y-4 overflow-auto px-6 py-5">
        {/* Project meta */}
        <section className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/40 p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">立项标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <FolderPlus className="h-3 w-3" />
              归属项目节点
            </label>
            <select
              value={parentProjectId}
              onChange={(e) => setParentProjectId(e.target.value as string | "new")}
              className="w-full cursor-pointer rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="new">+ 创建新项目节点</option>
              {EXISTING_PROJECTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} （已有 {p.task_count} 个任务）
                </option>
              ))}
            </select>
            {parentProjectId === "new" && (
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="新项目名称（例：电磁阀工艺升级 v2.1）"
                className="mt-2 w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
              />
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              {parentProjectId === "new"
                ? "AI 未找到合适的现有项目，将创建新节点；任务按各自分类路径散落到分类树。"
                : "任务将归属到此项目下，仍按各自分类路径散落到分类树。"}
            </p>
          </div>
        </section>

        {/* Tasks */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                AI 解析出 {tasks.length} 个任务
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-500">点击行展开编辑，可单独/批量请 AI 优化</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={requestAiOptimizeAll}
                className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition-all hover:-translate-y-0.5 hover:bg-violet-100 active:scale-95"
              >
                <Sparkles className="h-3 w-3" />
                请 AI 优化全部
              </button>
              <button
                type="button"
                onClick={addTask}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-all hover:-translate-y-0.5 hover:bg-slate-50 active:scale-95"
              >
                <Plus className="h-3 w-3" />
                手动添加
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/40 py-8 text-center text-xs text-slate-400">
                所有任务已被删除，请添加至少一个任务
              </div>
            ) : (
              tasks.map((task) => (
                <TaskEditRow
                  key={task.id}
                  task={task}
                  onChange={(t) => updateTask(task.id, t)}
                  onDelete={() => deleteTask(task.id)}
                  onRequestAiHelp={() => requestAiHelpForTask(task.id)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          返回修改
        </button>
        <button
          type="button"
          disabled={tasks.length === 0}
          onClick={onNext}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.2)] transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一步：审核流程
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </footer>
    </div>
  );
}

// ─── Step 4: Submit ──────────────────────────────────────────────────────────

function StepSubmit({
  userRole,
  taskCount,
  title,
  parentProjectId,
  newProjectName,
  comment,
  setComment,
  onBack,
  onSubmit,
  onSaveDraft,
  onDirectDispatch,
  canSubmitProposal,
  canDirectProject,
}: {
  userRole: UserRole;
  taskCount: number;
  title: string;
  parentProjectId: string | "new";
  newProjectName: string;
  comment: string;
  setComment: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  onSaveDraft: () => void;
  onDirectDispatch: () => void;
  canSubmitProposal: boolean;
  canDirectProject: boolean;
}) {
  const reviewNodes = getApplicableNodes(userRole);
  const canDirect = canDirectProject;
  const directOnly = userRole === "director" && canDirectProject;

  const projectName =
    parentProjectId === "new"
      ? newProjectName || "（新项目节点）"
      : EXISTING_PROJECTS.find((p) => p.id === parentProjectId)?.label ?? "—";

  return (
    <div className="flex max-h-[70vh] flex-col">
      <div className="space-y-5 overflow-auto px-6 py-5">
        {/* Summary */}
        <section className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 via-white to-blue-50/20 p-4">
          <div className="mb-2 text-xs font-medium text-slate-500">立项摘要</div>
          <h3 className="text-base font-semibold text-slate-900">{title || "未命名立项"}</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-500">归属项目</div>
              <div className="mt-0.5 font-medium text-slate-800">{projectName}</div>
            </div>
            <div>
              <div className="text-slate-500">任务数</div>
              <div className="mt-0.5 font-medium text-slate-800">{taskCount} 个</div>
            </div>
          </div>
        </section>

        {/* Review chain — driven by configured approval flow */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {directOnly ? "审批流程" : "审核流程"}
            </h4>
            {!directOnly && reviewNodes.length > 0 && (
              <span className="text-[10px] text-slate-400">
                来自审批流配置 · 共 {reviewNodes.length} 级
              </span>
            )}
          </div>

          {reviewNodes.length === 0 ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-xs text-emerald-700">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
              {canDirect ? "你有直接立项权限，立项可直接生效并自动分配" : "当前审批流没有后续审核节点，请联系管理员配置审批流或分配直接立项权限"}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Origin */}
              <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2">
                <MiniAvatar name="你" />
                <div className="flex-1">
                  <div className="text-xs font-medium text-slate-700">提交人</div>
                  <div className="text-[10px] text-slate-500">你</div>
                </div>
              </div>
              {/* Chain of approval nodes */}
              {reviewNodes.map((node, idx) => {
                const pool = getPoolForPermission(node.permission_code);
                const modeCfg = MODE_LABEL[node.mode];
                return (
                  <React.Fragment key={node.id}>
                    <div className="flex justify-center text-slate-300">
                      <ChevronRight className="h-3 w-3 rotate-90" />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[10px] font-bold text-white">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-800">{node.label}</span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              modeCfg.bg,
                              modeCfg.text,
                            )}
                          >
                            {modeCfg.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {pool.length > 0 ? `${pool.length} 人审核组` : "暂无候选人"}
                        </span>
                      </div>
                      {pool.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {pool.slice(0, 4).map((m) => (
                            <span
                              key={m.id}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                              title={`${m.name} · ${m.position}`}
                            >
                              <MiniAvatar name={m.name} size="xs" />
                              {m.name}
                            </span>
                          ))}
                          {pool.length > 4 && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              +{pool.length - 4}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="rounded border border-dashed border-amber-200 bg-amber-50/40 px-2 py-1.5 text-[10px] text-amber-700">
                          ⚠ 当前无人持有权限「{node.permission_code}」，请到角色权限页分配
                        </div>
                      )}
                      {node.description && (
                        <p className="mt-1.5 text-[10px] text-slate-400">{node.description}</p>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
              {/* Terminal */}
              <div className="flex justify-center text-slate-300">
                <ChevronRight className="h-3 w-3 rotate-90" />
              </div>
              <div className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold">通过 · 任务自动分配</span>
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-slate-400">
            {directOnly
              ? "厂长可直接立项，无需审核"
              : canDirect
                ? "你有「直接立项」权限，可选择跳过审核（适用于紧急/已对齐过的立项）"
                : "提交后进入审核队列。或签模式下任一审核人通过即转下一级，会签则需池内全部通过"}
          </p>
        </section>

        {/* Comment */}
        <section>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            备注 / 提交说明（可选）
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="例：本立项已与厂长口头对齐，关键节点请尽快推进。"
            className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-all focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
          />
        </section>

        {/* Warning */}
        {parentProjectId === "new" && !newProjectName.trim() && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              新项目节点未命名，将使用默认名「{title || "未命名立项"}」
            </span>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
        >
          <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          返回
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveDraft}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98]"
          >
            保存草稿
          </button>
          {reviewNodes.length > 0 && canSubmitProposal && (
            <button
              type="button"
              onClick={onSubmit}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] transition-all hover:bg-blue-700 active:scale-[0.98]"
            >
              提交审核
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
          {canDirect && (
            <button
              type="button"
              onClick={onDirectDispatch}
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(5,150,105,0.25)] transition-all hover:from-emerald-600 hover:to-emerald-700 active:scale-[0.98]"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {directOnly ? "立项并分配" : "直接立项并分配"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────

export function RDProjectProposalDialog({
  open,
  onClose,
  userRole = "user",
}: {
  open: boolean;
  onClose: () => void;
  userRole?: UserRole;
}) {
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tasks, setTasks] = useState<ProposedTask[]>([]);
  const [parentProjectId, setParentProjectId] = useState<string | "new">("new");
  const [newProjectName, setNewProjectName] = useState("");
  const [comment, setComment] = useState("");
  const [aiProgress, setAiProgress] = useState(0);
  const [aiLabel, setAiLabel] = useState("");
  const [proposalId, setProposalId] = useState(createProposalId);
  const auditActor = PROPOSAL_ACTORS[userRole];
  const canSubmitProposal = usePermission(PERMISSIONS.RD_PROJECT_PROPOSE);
  const canDirectProject = usePermission(PERMISSIONS.RD_PROJECT_DIRECT);

  const STEP_LABELS: Record<Step, string> = {
    1: "描述内容",
    2: "AI 解析中",
    3: "审阅 AI 输出",
    4: "提交审核",
  };

  const reset = () => {
    setStep(1);
    setTitle("");
    setDescription("");
    setFiles([]);
    setTasks([]);
    setParentProjectId("new");
    setNewProjectName("");
    setComment("");
    setAiProgress(0);
    setProposalId(createProposalId());
  };

  const handleClose = () => {
    onClose();
    setTimeout(reset, 200); // wait for close animation
  };

  // Mock AI processing
  const runAiParse = () => {
    const attachmentTextPromise = extractProposalAttachmentText(files).catch(() => {
      toast.error("附件读取失败，请重新选择文件");
      return "";
    });
    recordAudit({
      actor: auditActor,
      action: "ai.parse_triggered",
      resource: { type: "proposal", id: proposalId, name: title || "AI 立项" },
      comment: "发起 AI 立项解析",
      metadata: {
        input_type: description.trim() ? (files.length > 0 ? "text_and_files" : "text") : "files",
        attachment_count: files.length,
      },
      source: "web",
    });
    setStep(2);
    setAiProgress(0);
    const stages = [
      { label: "解析文本内容…", to: 25 },
      { label: "提取任务项…", to: 55 },
      { label: "按规则 A5.3 匹配责任人…", to: 80 },
      { label: "估算工期与优先级…", to: 100 },
    ];

    let cursor = 0;
    const tick = () => {
      if (cursor >= stages.length) {
        // Done
        attachmentTextPromise.then((attachmentText) => {
          const aiInput = [description, attachmentText].filter((item) => item.trim()).join("\n\n");
          const parsedTasks = mockAiParse(title, aiInput);
          setTasks(parsedTasks);
          if (!title) {
            setTitle(parsedTasks[0]?.title.replace(/[（(].*$/, "").trim() ?? "AI 立项");
          }
          const suggestedProject = mockSuggestProject(aiInput);
          if (suggestedProject) {
            setParentProjectId(suggestedProject);
          }
          setTimeout(() => setStep(3), 250);
        });
        return;
      }
      const stage = stages[cursor];
      setAiLabel(stage.label);
      const start = cursor === 0 ? 0 : stages[cursor - 1].to;
      const duration = 600;
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const ratio = Math.min(1, elapsed / duration);
        setAiProgress(Math.round(start + (stage.to - start) * ratio));
        if (ratio >= 1) {
          clearInterval(interval);
          cursor++;
          tick();
        }
      }, 16);
    };
    tick();
  };

  const handleSubmit = () => {
    if (!canSubmitProposal) {
      toast.error("当前账号没有立项申请权限");
      return;
    }
    recordAudit({
      actor: auditActor,
      action: "proposal.submitted",
      resource: { type: "proposal", id: proposalId, name: title || "未命名立项" },
      comment: comment || "提交立项审核",
      metadata: {
        task_count: tasks.length,
        review_node_count: getApplicableNodes(userRole).length,
        parent_project_id: parentProjectId,
      },
      source: "web",
    });
    toast.success("立项已提交审核", {
      description: `共 ${tasks.length} 个任务，预计 24 小时内完成审核流转`,
    });
    handleClose();
  };

  const handleSaveDraft = () => {
    recordAudit({
      actor: auditActor,
      action: "proposal.draft_saved",
      resource: { type: "proposal", id: proposalId, name: title || "未命名立项" },
      comment: comment || "保存立项草稿",
      metadata: { task_count: tasks.length, attachment_count: files.length },
      source: "web",
    });
    toast.info("立项已保存为草稿", {
      description: "可在「我的立项」中继续编辑",
    });
    handleClose();
  };

  const handleDirectDispatch = () => {
    if (!canDirectProject) {
      toast.error("当前账号没有直接立项权限");
      return;
    }
    recordAudit({
      actor: auditActor,
      action: "proposal.direct_dispatched",
      resource: { type: "proposal", id: proposalId, name: title || "未命名立项" },
      comment: comment || "直接立项并分配任务",
      metadata: {
        task_count: tasks.length,
        parent_project_id: parentProjectId,
        project_name: parentProjectId === "new" ? newProjectName || title || "未命名立项" : parentProjectId,
      },
      source: "web",
    });
    tasks.forEach((task) => {
      recordAudit({
        actor: auditActor,
        action: "task.created",
        resource: { type: "task", id: task.id, name: task.title },
        changes: [
          { field: "owner", before: undefined, after: task.owner },
          { field: "priority", before: undefined, after: task.priority },
          { field: "due_date", before: undefined, after: task.due_date },
        ],
        comment: "立项直接生效后自动创建任务",
        metadata: { proposal_id: proposalId, category_path: task.category_path },
        source: "web",
      });
    });
    toast.success("立项已生效并自动分配", {
      description: `${tasks.length} 个任务已下发至责任人，相关人员将收到通知`,
    });
    handleClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm animate-rd-fade-in"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] animate-rd-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">AI 立项</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                第 {step} / 4 步 · {STEP_LABELS[step]}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            type="button"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Step progress bar */}
        <div className="flex h-1 bg-slate-100">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={cn(
                "flex-1 transition-all duration-300",
                s <= step ? "bg-gradient-to-r from-blue-500 to-violet-500" : "bg-transparent",
              )}
            />
          ))}
        </div>

        {/* Step content */}
        {step === 1 && (
          <StepInput
            title={title}
            setTitle={setTitle}
            description={description}
            setDescription={setDescription}
            files={files}
            setFiles={setFiles}
            onNext={runAiParse}
            onClose={handleClose}
          />
        )}
        {step === 2 && <StepProcessing progress={aiProgress} label={aiLabel} />}
        {step === 3 && (
          <StepReview
            title={title}
            setTitle={setTitle}
            parentProjectId={parentProjectId}
            setParentProjectId={setParentProjectId}
            newProjectName={newProjectName}
            setNewProjectName={setNewProjectName}
            tasks={tasks}
            setTasks={setTasks}
            proposalId={proposalId}
            auditActor={auditActor}
            onBack={() => setStep(1)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <StepSubmit
            userRole={userRole}
            taskCount={tasks.length}
            title={title}
            parentProjectId={parentProjectId}
            newProjectName={newProjectName}
            comment={comment}
            setComment={setComment}
            onBack={() => setStep(3)}
            onSubmit={handleSubmit}
            onSaveDraft={handleSaveDraft}
            onDirectDispatch={handleDirectDispatch}
            canSubmitProposal={canSubmitProposal}
            canDirectProject={canDirectProject}
          />
        )}
      </div>
    </div>
  );
}

export default RDProjectProposalDialog;
