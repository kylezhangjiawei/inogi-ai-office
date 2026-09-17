import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CloudUpload,
  Download,
  FileCheck2,
  FileDiff,
  FileSearch,
  FileText,
  Fingerprint,
  History,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  ExternalDocumentEvidenceViewer,
  type ExternalEvidenceDifference,
} from "./components/ExternalDocumentEvidenceViewer";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
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
  AlertDialogTrigger,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./components/ui/utils";
import {
  archiveExternalComparison,
  createExternalDocument,
  getExternalDocument,
  getExternalDocumentVersionDownloadContent,
  listExternalDocuments,
  replaceExternalComparisonCandidate,
  regenerateExternalComparisonSummary,
  retryExternalComparison,
  reviewAllExternalDifferences,
  reviewExternalDifference,
  uploadExternalDocumentVersion,
  type ExternalDocumentDetail,
  type ExternalIntegrationStatus,
} from "./lib/externalDocsApi";
import { NativeSelect } from "./components/ui/native-select";

type DocumentStatus = "current" | "review" | "comparing" | "failed";
type DifferenceType = "modified" | "added" | "removed" | "format";
type DifferenceRisk = "high" | "medium" | "low";
type CompareStatus = "comparing" | "review" | "archived" | "failed";
type WorkspaceTab = "differences" | "summary" | "history";
type DifferenceFilter = "all" | "high" | DifferenceType;

interface DocumentSet {
  id: string;
  code: string;
  name: string;
  category: string;
  owner: string;
  currentVersion: string;
  currentFile: string;
  updatedAt: string;
  totalVersions: number;
  status: DocumentStatus;
  pendingCount: number;
  allowSend: boolean;
}

interface DifferenceItem {
  id: string;
  type: DifferenceType;
  risk: DifferenceRisk;
  location: string;
  title: string;
  before: string;
  after: string;
  confidence: number;
  reviewed: boolean;
  source: string;
}

interface VersionRecord {
  id: string;
  version: string;
  fileName: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  status: "current" | "pending" | "superseded" | "failed";
  hash: string;
  compareId?: string;
  comparisonId?: string;
  uploadRevision: number;
  replacementHistory: Array<{
    revision: number;
    fileName: string;
    size: string;
    hash: string;
    uploadedBy: string;
    uploadedAt: string;
    replacedAt: string;
    replacedBy: string;
    reason: string;
  }>;
}

type UploadMode = "newDocument" | "newVersion" | "replaceCandidate";

const statusConfig: Record<DocumentStatus, { label: string; className: string }> = {
  current: { label: "当前有效", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  review: { label: "待人工确认", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  comparing: { label: "版本比对中", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  failed: { label: "比对失败", className: "bg-rose-50 text-rose-700 ring-rose-200" },
};

const differenceTypeConfig: Record<DifferenceType, { label: string; className: string }> = {
  modified: { label: "修改", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  added: { label: "新增", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  removed: { label: "删除", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  format: { label: "版式", className: "bg-slate-100 text-slate-700 ring-slate-200" },
};

const riskConfig: Record<DifferenceRisk, { label: string; className: string }> = {
  high: { label: "高风险", className: "bg-rose-50 text-rose-700" },
  medium: { label: "需关注", className: "bg-amber-50 text-amber-700" },
  low: { label: "低风险", className: "bg-slate-100 text-slate-600" },
};

function nextVersion(version: string) {
  const matched = version.match(/^(.*?)(\d+)(?:\.(\d+))?$/);
  if (!matched) return "V1.1";
  const prefix = matched[1] || "V";
  const major = Number(matched[2]);
  const minor = Number(matched[3] ?? 0) + 1;
  return `${prefix}${major}.${minor}`;
}

function fileSizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDate(value: string, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date).replaceAll("/", "-");
}

const emptyDocument: DocumentSet = {
  id: "",
  code: "",
  name: "暂无资料",
  category: "未分类",
  owner: "",
  currentVersion: "—",
  currentFile: "—",
  updatedAt: "—",
  totalVersions: 0,
  status: "current",
  pendingCount: 0,
  allowSend: false,
};

function StatusBadge({ status }: { status: DocumentStatus }) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", config.className)}>
      {config.label}
    </span>
  );
}

export function ExternalDocsPage() {
  const [documents, setDocuments] = useState<DocumentSet[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("differences");
  const [differenceFilter, setDifferenceFilter] = useState<DifferenceFilter>("all");
  const [differences, setDifferences] = useState<DifferenceItem[]>([]);
  const [comparisonStatus, setComparisonStatus] = useState<CompareStatus>("archived");
  const [comparisonId, setComparisonId] = useState("");
  const [comparisonError, setComparisonError] = useState("");
  const [activeComparisonDocId, setActiveComparisonDocId] = useState("");
  const [baselineVersion, setBaselineVersion] = useState("—");
  const [baselineFileName, setBaselineFileName] = useState("—");
  const [candidateVersion, setCandidateVersion] = useState("—");
  const [candidateFileName, setCandidateFileName] = useState("—");
  const [candidateFileSize, setCandidateFileSize] = useState("—");
  const [compareJobId, setCompareJobId] = useState("尚未创建比对任务");
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [integration, setIntegration] = useState<ExternalIntegrationStatus | null>(null);
  const [aiModel, setAiModel] = useState("");
  const [aiGenerationMode, setAiGenerationMode] = useState<"ai" | "fallback">("fallback");
  const [aiWarning, setAiWarning] = useState("");
  const [ocrProvider, setOcrProvider] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("newVersion");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVersion, setUploadVersion] = useState("V3.2");
  const [uploadCategory, setUploadCategory] = useState("产品资料");
  const [newDocumentName, setNewDocumentName] = useState("");
  const [uploadNote, setUploadNote] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [openingVersionId, setOpeningVersionId] = useState("");
  const [summary, setSummary] = useState("");
  const [evidenceDifference, setEvidenceDifference] = useState<ExternalEvidenceDifference | null>(null);
  const closeUploadDialog = useCallback(() => {
    if (!isUploading) setShowUpload(false);
  }, [isUploading]);

  const selectedDocument = documents.find((item) => item.id === selectedId) ?? documents[0] ?? emptyDocument;
  const hasDocuments = documents.length > 0;
  const comparisonVisible = Boolean(selectedDocument.id && selectedDocument.id === activeComparisonDocId);
  const reviewedCount = differences.filter((item) => item.reviewed).length;
  const allReviewed = reviewedCount === differences.length;
  const baselineRecord = versions.find((item) => item.version === baselineVersion);
  const candidateRecord = versions.find((item) => item.comparisonId === comparisonId && item.version === candidateVersion);

  const normalizeDocument = useCallback((document: ExternalDocumentDetail["document"]): DocumentSet => ({
    ...document,
    status: document.status as DocumentStatus,
    updatedAt: formatDate(document.updatedAt),
  }), []);

  const applyDetail = useCallback((detail: ExternalDocumentDetail) => {
    const document = normalizeDocument(detail.document);
    setDocuments((previous) => {
      const exists = previous.some((item) => item.id === document.id);
      return exists
        ? previous.map((item) => item.id === document.id ? document : item)
        : [document, ...previous];
    });
    setSelectedId(document.id);
    setIntegration(detail.integration);
    setVersions(detail.versions.map((version) => ({
      id: version.id,
      version: version.version,
      fileName: version.fileName,
      size: fileSizeLabel(version.fileSize),
      uploadedBy: version.uploadedBy || "未知上传人",
      uploadedAt: formatDate(version.uploadedAt, true),
      status: version.status,
      hash: `SHA256 · ${version.hash.slice(0, 8)}…${version.hash.slice(-4)}`,
      compareId: version.compareId,
      comparisonId: version.comparisonId,
      uploadRevision: version.uploadRevision ?? 1,
      replacementHistory: (version.replacementHistory ?? []).map((replacement) => ({
        revision: replacement.revision,
        fileName: replacement.fileName,
        size: fileSizeLabel(replacement.fileSize),
        hash: `SHA256 · ${replacement.hash.slice(0, 8)}…${replacement.hash.slice(-4)}`,
        uploadedBy: replacement.uploadedBy || "未知上传人",
        uploadedAt: formatDate(replacement.uploadedAt, true),
        replacedAt: formatDate(replacement.replacedAt, true),
        replacedBy: replacement.replacedBy || "未知操作人",
        reason: replacement.reason || "候选文件上传纠正",
      })),
    })));

    const comparison = detail.comparison;
    if (!comparison) {
      setActiveComparisonDocId("");
      setComparisonId("");
      setComparisonStatus("archived");
      setComparisonError("");
      setDifferences([]);
      setSummary("");
      setCompareJobId("尚未创建比对任务");
      setAiModel("");
      setAiGenerationMode("fallback");
      setAiWarning("");
      setOcrProvider("");
      setOcrConfidence(null);
      return;
    }

    setActiveComparisonDocId(document.id);
    setComparisonId(comparison.id);
    setComparisonStatus(comparison.status);
    setComparisonError(comparison.errorMessage || "");
    setDifferences(comparison.differences as DifferenceItem[]);
    setSummary(comparison.summary || "");
    setCompareJobId(comparison.jobCode);
    setBaselineVersion(comparison.baseline?.version ?? "—");
    setBaselineFileName(comparison.baseline?.fileName ?? "—");
    setCandidateVersion(comparison.candidate?.version ?? "—");
    setCandidateFileName(comparison.candidate?.fileName ?? "—");
    setCandidateFileSize(comparison.candidate ? fileSizeLabel(comparison.candidate.fileSize) : "—");
    setAiModel(comparison.aiModel || detail.integration.ai.model || "");
    setAiGenerationMode(comparison.aiGenerationMode || (comparison.aiProvider?.includes("fallback") ? "fallback" : "ai"));
    setAiWarning(comparison.aiWarning || "");
    setOcrProvider(comparison.ocrProvider || "");
    setOcrConfidence(comparison.ocrConfidence);
  }, [normalizeDocument]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await listExternalDocuments(controller.signal);
        const items = response.items.map(normalizeDocument);
        setDocuments(items);
        setIntegration(response.integration);
        if (items[0]) applyDetail(await getExternalDocument(items[0].id, controller.signal));
      } catch (error) {
        if ((error as Error).name !== "AbortError") toast.error((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [applyDetail, normalizeDocument]);

  useEffect(() => {
    if (!selectedId || comparisonStatus !== "comparing") return;
    const timer = window.setInterval(() => {
      void getExternalDocument(selectedId)
        .then(applyDetail)
        .catch((error) => toast.error((error as Error).message));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [applyDetail, comparisonStatus, selectedId]);

  const filteredDocuments = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter((item) =>
      `${item.name} ${item.category} ${item.owner} ${item.currentVersion}`.toLowerCase().includes(normalized),
    );
  }, [documents, searchQuery]);

  const filteredDifferences = useMemo(() => {
    if (differenceFilter === "all") return differences;
    if (differenceFilter === "high") return differences.filter((item) => item.risk === "high");
    return differences.filter((item) => item.type === differenceFilter);
  }, [differenceFilter, differences]);

  const openEvidenceViewer = (difference: DifferenceItem) => {
    if (!baselineRecord || !candidateRecord) {
      toast.error("暂时无法定位两个版本的原文件，请刷新页面后重试");
      return;
    }
    setEvidenceDifference(difference);
  };

  const openUploadDialog = (mode: UploadMode) => {
    if (mode === "newVersion" && !selectedDocument.id) {
      toast.error("请先建立一份资料首版");
      return;
    }
    if (mode === "replaceCandidate" && (!comparisonId || !comparisonVisible || comparisonStatus === "archived")) {
      toast.error("当前没有可纠正的候选文件");
      return;
    }
    setUploadMode(mode);
    setUploadFile(null);
    setUploadNote("");
    setUploadError("");
    setNewDocumentName("");
    setUploadVersion(mode === "replaceCandidate" ? candidateVersion : mode === "newVersion" ? nextVersion(selectedDocument.currentVersion) : "V1.0");
    setUploadCategory(mode === "newDocument" ? "产品资料" : selectedDocument.category);
    setShowUpload(true);
  };

  const selectUploadFile = (file: File | null) => {
    setUploadFile(file);
    if (file) setUploadError("");
    if (file && uploadMode === "newDocument" && !newDocumentName) {
      setNewDocumentName(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectUploadFile(event.target.files?.[0] ?? null);
  };

  const selectDocument = async (documentId: string) => {
    setSelectedId(documentId);
    try {
      applyDetail(await getExternalDocument(documentId));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("请先选择需要上传的文件");
      toast.error("请先选择需要上传的文件");
      return;
    }
    if (uploadMode !== "replaceCandidate" && !uploadVersion.trim()) {
      setUploadError("请填写版本号");
      toast.error("请填写版本号");
      return;
    }
    if (uploadMode === "newDocument" && !newDocumentName.trim()) {
      setUploadError("请填写资料名称");
      toast.error("请填写资料名称");
      return;
    }

    setUploadError("");
    setIsUploading(true);
    try {
      if (uploadMode === "newDocument") {
        applyDetail(await createExternalDocument({
          file: uploadFile,
          name: newDocumentName.trim(),
          category: uploadCategory,
          version: uploadVersion.trim(),
          notes: uploadNote.trim(),
        }));
        toast.success("首版资料已建档，可继续上传同一资料的新版本");
      } else if (uploadMode === "newVersion") {
        applyDetail(await uploadExternalDocumentVersion(selectedDocument.id, {
          file: uploadFile,
          version: uploadVersion.trim(),
          notes: uploadNote.trim(),
        }));
        setWorkspaceTab("differences");
        toast.success("新版本上传成功，已启动版本比对");
      } else {
        applyDetail(await replaceExternalComparisonCandidate(comparisonId, {
          file: uploadFile,
          reason: uploadNote.trim(),
        }));
        setWorkspaceTab("differences");
        toast.success("候选文件已纠正，旧文件已保留并重新启动比对");
      }
      setShowUpload(false);
    } catch (error) {
      const message = (error as Error).message;
      setUploadError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const toggleDifference = async (id: string) => {
    if (comparisonStatus !== "review" || !comparisonId) return;
    const current = differences.find((item) => item.id === id);
    if (!current) return;
    const reviewed = !current.reviewed;
    setDifferences((previous) => previous.map((item) => item.id === id ? { ...item, reviewed } : item));
    try {
      const result = await reviewExternalDifference(comparisonId, id, reviewed);
      setDifferences(result.differences as DifferenceItem[]);
    } catch (error) {
      setDifferences((previous) => previous.map((item) => item.id === id ? { ...item, reviewed: !reviewed } : item));
      toast.error((error as Error).message);
    }
  };

  const handleReviewAll = async () => {
    if (!comparisonId || comparisonStatus !== "review") return;
    setIsActionPending(true);
    try {
      const result = await reviewAllExternalDifferences(comparisonId);
      setDifferences(result.differences as DifferenceItem[]);
      toast.success("全部差异已标记为复核");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRegenerateSummary = async () => {
    if (!comparisonId) return;
    setIsActionPending(true);
    try {
      const result = await regenerateExternalComparisonSummary(comparisonId);
      setSummary(result.summary);
      setAiModel(result.model);
      setAiGenerationMode(result.generationMode);
      setAiWarning(result.warning || "");
      if (result.generationMode === "ai") {
        toast.success("已使用 AI 根据复核结果重新生成摘要");
      } else {
        toast.warning(result.warning || "AI 当前不可用，已使用确定性规则生成摘要");
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleArchive = async () => {
    if (comparisonStatus !== "review") return;
    if (!allReviewed) {
      toast.error(`还有 ${differences.length - reviewedCount} 处差异未复核，暂不能归档`);
      setWorkspaceTab("differences");
      return;
    }
    setIsActionPending(true);
    try {
      applyDetail(await archiveExternalComparison(comparisonId, summary));
      toast.success(`${candidateVersion} 已确认归档，并设为当前有效版本`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsActionPending(false);
    }
  };

  const handleRetry = async () => {
    if (!comparisonId) return;
    setIsActionPending(true);
    try {
      applyDetail(await retryExternalComparison(comparisonId));
      toast.success("已重新启动 AI/OCR 比对");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setIsActionPending(false);
    }
  };

  const openVersionFile = async (version: VersionRecord, revision?: number) => {
    const openingId = `${version.id}:${revision ?? version.uploadRevision}`;
    setOpeningVersionId(openingId);
    try {
      const blob = await getExternalDocumentVersionDownloadContent(version.id, revision);
      const replacement = revision == null
        ? null
        : version.replacementHistory.find((item) => item.revision === revision);
      downloadBlob(blob, replacement?.fileName || version.fileName);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setOpeningVersionId("");
    }
  };

  const displayedVersions = versions;
  const totalVersionCount = documents.reduce((total, document) => total + document.totalVersions, 0);
  const pendingReviewCount = documents.filter((document) => document.status === "review").length;
  const activeComparisonCount = documents.filter((document) => document.status === "comparing").length;
  const versionUploadDisabled = !hasDocuments || selectedDocument.status === "comparing" || selectedDocument.status === "review";

  return (
    <div className="horizon-theme hz-page flex min-h-full min-w-0 flex-col gap-3 overflow-x-hidden px-5 py-4 xl:h-full xl:min-h-0 xl:overflow-hidden">
      <HorizonPageHeader
        Icon={FileCheck2}
        eyebrow="文件与知识 · 对外资料控制"
        title="对外资料版本"
        description="集中管理对外资料、候选版本与 AI / OCR 差异证据，在人工复核后完成受控归档。"
        meta={(
          <>
            <span>AI {integration?.ai.configured ? "已配置" : "未配置"}</span>
            <span>·</span>
            <span>OCR {integration?.ocr.configured ? "已配置" : "未配置"}</span>
            <span>·</span>
            <span>{compareJobId}</span>
          </>
        )}
        actions={(
          <>
            <Button type="button" variant="outline" onClick={() => openUploadDialog("newDocument")}>
              <Plus className="size-4" />
              新建资料首版
            </Button>
            <Button
              type="button"
              className={versionUploadDisabled ? "border border-slate-200 bg-slate-100 text-muted-foreground opacity-100 hover:bg-slate-100 disabled:opacity-100" : "hz-primary-action"}
              onClick={() => openUploadDialog("newVersion")}
              disabled={versionUploadDisabled}
            >
              <CloudUpload className="size-4" />
              上传新版本
            </Button>
          </>
        )}
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={FileText} label="受控资料" value={documents.length} note="当前资料库总数" tone="brand" />
        <HorizonMetric Icon={History} label="累计版本" value={totalVersionCount} note="保留哈希与上传记录" tone="neutral" />
        <HorizonMetric Icon={CircleDot} label="待人工确认" value={pendingReviewCount} note="需要完成差异复核" tone={pendingReviewCount ? "warning" : "success"} />
        <HorizonMetric Icon={FileSearch} label="比对处理中" value={activeComparisonCount} note="AI / OCR 后台任务" tone={activeComparisonCount ? "brand" : "neutral"} />
      </HorizonMetricGrid>

      <div className="mx-auto flex min-h-0 w-full max-w-[1680px] flex-1 flex-col">
        <div className="grid min-h-0 min-w-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)] xl:overflow-hidden">
          <aside className="hz-surface flex min-h-[360px] min-w-0 flex-col overflow-hidden border bg-white xl:min-h-0">
            <HorizonSectionHeader
              Icon={FileText}
              title="资料清单"
              description="按名称、分类、负责人或版本搜索。"
              trailing={<span className="text-xs text-slate-500 tabular-nums">{documents.length} 组</span>}
            />
            <div className="hz-toolbar shrink-0 border-b p-3">
              <Label htmlFor="external-doc-search" className="sr-only">搜索对外资料</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="external-doc-search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索资料、分类、版本…"
                  className="h-9 rounded-xl border-slate-200 bg-white pl-9 text-xs"
                />
              </div>
            </div>
            <div className="material-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2 [scrollbar-gutter:stable]">
              {isLoading && (
                <div className="space-y-2 p-1" aria-label="正在读取资料库" role="status">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="rounded-xl border border-slate-100 p-3">
                      <div className="h-3 w-2/3 rounded bg-slate-200" />
                      <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-100" />
                      <div className="mt-3 h-6 w-full rounded bg-slate-100" />
                    </div>
                  ))}
                </div>
              )}
              {!isLoading && filteredDocuments.length === 0 && (
                <HorizonEmptyState
                  Icon={FileText}
                  title={documents.length ? "没有匹配的资料" : "还没有受控资料"}
                  description={documents.length ? "清除搜索条件后可继续浏览全部资料。" : "上传首版文件，建立第一份受控资料。"}
                  action={documents.length
                    ? <Button type="button" size="sm" variant="outline" onClick={() => setSearchQuery("")}>清除搜索</Button>
                    : <Button type="button" size="sm" className="hz-primary-action" onClick={() => openUploadDialog("newDocument")}><Plus className="size-4" />新建首版</Button>}
                />
              )}
              {filteredDocuments.map((document) => {
                const selected = document.id === selectedDocument.id;
                return (
                  <Button variant="unstyled"
                    key={document.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => void selectDocument(document.id)}
                    className={cn(
                      "w-full cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors duration-150",
                      selected ? "border-primary bg-accent" : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("mt-0.5 rounded-lg p-2", selected ? "bg-white text-primary" : "bg-slate-100 text-slate-500")}>
                        <FileText className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{document.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{document.category} · {document.owner}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                            {document.currentVersion}
                          </span>
                          <StatusBadge status={document.status} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                          <span>{document.totalVersions} 个版本</span>
                          <span>{document.updatedAt}</span>
                        </div>
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
          </aside>

          <section className="hz-surface flex min-h-[560px] min-w-0 flex-col overflow-hidden border bg-white xl:min-h-0">
            <div className="shrink-0 border-b border-slate-200 px-4 py-3">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-balance text-base font-semibold text-[#1b2559]">{selectedDocument.name}</h2>
                    <StatusBadge status={selectedDocument.status} />
                  </div>
                  <p className="mt-1 truncate text-pretty text-xs text-slate-500 tabular-nums">{selectedDocument.code || "尚未建档"} · {selectedDocument.owner || "—"} · {compareJobId}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {comparisonVisible ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setWorkspaceTab("history")}>
                      <History className="size-4" />
                      版本溯源
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    onClick={() => openUploadDialog("newVersion")}
                    disabled={versionUploadDisabled}
                    size="sm"
                    className={versionUploadDisabled ? "border border-slate-200 bg-slate-100 text-muted-foreground opacity-100 hover:bg-slate-100 disabled:opacity-100" : "hz-primary-action"}
                  >
                    <CloudUpload className="size-4" />
                    上传该资料新版本
                  </Button>
                </div>
              </div>
            </div>

            {!hasDocuments ? (
              <HorizonEmptyState
                Icon={Archive}
                title="建立第一份受控资料"
                description="上传首版文件后，系统会固化原文件、SHA256 哈希、上传人和解析证据。"
                action={<Button type="button" className="hz-primary-action" onClick={() => openUploadDialog("newDocument")}><Plus className="size-4" />新建资料首版</Button>}
              />
            ) : !comparisonVisible ? (
              <HorizonEmptyState
                Icon={FileDiff}
                title="当前没有待处理的版本比对"
                description={`当前有效版本为 ${selectedDocument.currentVersion}。上传同一资料的新文件后，系统会自动与当前版本进行 AI / OCR 差异分析。`}
                action={<Button type="button" className="hz-primary-action" onClick={() => openUploadDialog("newVersion")}><Upload className="size-4" />上传新版本开始比对</Button>}
              />
            ) : (
              <>
                <div className="shrink-0 border-b border-slate-200 bg-slate-50/70 p-3">
                  <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-slate-500">当前基准版</span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">{baselineVersion}</span>
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-slate-900">{baselineFileName}</p>
                      <p className="mt-1 text-xs text-slate-500">已归档 · {versions.find((item) => item.version === baselineVersion)?.hash || "SHA256 · 已固化"}</p>
                    </div>
                    <div className="flex items-center justify-center">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-700 text-white shadow-sm">
                        <ChevronRight className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-blue-700">候选新版本</span>
                        <span className="rounded-md bg-white px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">{candidateVersion}</span>
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-slate-900">{candidateFileName}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-xs text-slate-500">{candidateFileSize} · {compareJobId}</p>
                        {comparisonStatus !== "archived" && (
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => openUploadDialog("replaceCandidate")}
                            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/25 bg-white px-2.5 text-[11px] font-semibold text-primary transition-colors duration-200 hover:border-primary/25 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            title="候选文件上传错误时，用正确文件替换并重新比对"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            重新上传候选文件
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {comparisonStatus === "comparing" ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center" aria-live="polite">
                    <div className="relative">
                      <div className="rounded-2xl bg-blue-50 p-5 text-blue-700">
                        <FileSearch className="h-9 w-9" />
                      </div>
                      <Loader2 className="absolute -right-2 -top-2 h-6 w-6 animate-spin rounded-full bg-white p-1 text-blue-700 shadow" />
                    </div>
                    <h3 className="mt-5 text-balance text-base font-semibold text-slate-900">AI / OCR 正在比对两个版本</h3>
                    <p className="mt-2 max-w-md text-pretty text-sm leading-6 text-slate-500">正在解析文本、表格、图片和版面坐标，并建立可回查的证据定位。</p>
                    <div className="mt-5 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
                      <div className="h-2 w-3/4 animate-pulse rounded-full bg-blue-600" />
                    </div>
                    <div className="mt-4 grid w-full max-w-md grid-cols-4 gap-2 text-[11px] text-slate-500">
                      <span className="rounded-lg bg-blue-50 py-2 text-blue-700">文本解析中</span>
                      <span className="rounded-lg bg-slate-50 py-2">扫描件按需 OCR</span>
                      <span className="rounded-lg bg-blue-50 py-2 text-blue-700">语义比对中</span>
                      <span className="rounded-lg bg-slate-50 py-2">总结待生成</span>
                    </div>
                  </div>
                ) : comparisonStatus === "failed" ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center" aria-live="polite">
                    <div className="rounded-2xl bg-rose-50 p-5 text-rose-700"><FileDiff className="h-9 w-9" /></div>
                    <h3 className="mt-5 text-balance text-base font-semibold text-slate-900">AI / OCR 比对失败</h3>
                    <p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-slate-500">{comparisonError || "比对服务暂时不可用，请检查 AI 与 OCR 配置后重试。"}</p>
                    <Button type="button" onClick={() => void handleRetry()} disabled={isActionPending} className="hz-primary-action mt-5">
                      {isActionPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}重新启动比对
                    </Button>
                  </div>
                ) : (
                  <>
                    <Tabs
                      value={workspaceTab}
                      onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)}
                      className="min-h-0 flex-1 gap-0 overflow-hidden"
                    >
                      <div className="shrink-0 overflow-x-auto border-b border-slate-200 px-4 pt-3 sm:px-5">
                        <TabsList className="h-auto w-max gap-5 rounded-none bg-transparent p-0">
                        {([
                          ["differences", `差异清单 ${differences.length}`],
                          ["summary", "AI 变更总结"],
                          ["history", "版本溯源"],
                        ] as Array<[WorkspaceTab, string]>).map(([key, label]) => (
                          <TabsTrigger
                            key={key}
                            value={key}
                            className="h-auto rounded-none border-x-0 border-t-0 border-b-2 border-transparent bg-transparent px-1 pb-3 pt-0 text-sm font-semibold text-slate-500 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"
                          >
                            {label}
                          </TabsTrigger>
                        ))}
                        </TabsList>
                      </div>

                      <div className="material-scrollbar min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                      <TabsContent value="differences" className="m-0">
                      <div>
                        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5 lg:flex-row lg:items-center">
                          <div className="flex flex-wrap gap-1.5">
                            {([
                              ["all", `全部 ${differences.length}`],
                              ["high", `高风险 ${differences.filter((item) => item.risk === "high").length}`],
                              ["modified", `修改 ${differences.filter((item) => item.type === "modified").length}`],
                              ["added", `新增 ${differences.filter((item) => item.type === "added").length}`],
                              ["removed", `删除 ${differences.filter((item) => item.type === "removed").length}`],
                              ["format", `版式 ${differences.filter((item) => item.type === "format").length}`],
                            ] as Array<[DifferenceFilter, string]>).map(([key, label]) => (
                              <Button variant="unstyled"
                                key={key}
                                type="button"
                                aria-pressed={differenceFilter === key}
                                onClick={() => setDifferenceFilter(key)}
                                className={cn(
                                  "cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                  differenceFilter === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                                )}
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => void handleReviewAll()}
                            disabled={comparisonStatus !== "review" || allReviewed || isActionPending}
                            className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-lg px-2 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50 lg:self-auto"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            全部标记为已复核
                          </Button>
                        </div>

                        <div className="divide-y divide-slate-100">
                          {filteredDifferences.map((difference) => (
                            <article key={difference.id} className={cn("p-4 transition-colors sm:p-5", difference.reviewed ? "bg-white" : "bg-amber-50/20")}>
                              <div className="flex items-start gap-3">
                                <Button variant="unstyled"
                                  type="button"
                                  aria-label={`${difference.reviewed ? "取消" : "确认"}${difference.title}`}
                                  aria-pressed={difference.reviewed}
                                  onClick={() => void toggleDifference(difference.id)}
                                  disabled={comparisonStatus !== "review"}
                                  className={cn(
                                    "mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default",
                                    difference.reviewed ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-transparent hover:border-primary",
                                  )}
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", differenceTypeConfig[difference.type].className)}>
                                      {differenceTypeConfig[difference.type].label}
                                    </span>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", riskConfig[difference.risk].className)}>
                                      {riskConfig[difference.risk].label}
                                    </span>
                                    <span className="text-[11px] text-slate-500">{difference.location}</span>
                                    <span className="ml-auto text-[11px] text-muted-foreground">置信度 {difference.confidence}%</span>
                                  </div>
                                  <h3 className="mt-2 text-balance text-sm font-semibold text-slate-900">{difference.title}</h3>
                                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                    <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3">
                                      <p className="text-[10px] font-bold text-rose-600">{baselineVersion} 原内容</p>
                                      <p className="mt-1.5 break-words text-pretty text-xs leading-5 text-slate-700">{difference.before}</p>
                                    </div>
                                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                                      <p className="text-[10px] font-bold text-emerald-700">{candidateVersion} 新内容</p>
                                      <p className="mt-1.5 break-words text-pretty text-xs leading-5 text-slate-700">{difference.after}</p>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                                    <span className="inline-flex items-center gap-1"><Fingerprint className="h-3.5 w-3.5" />{difference.source}</span>
                                    <Button variant="unstyled" type="button" onClick={() => openEvidenceViewer(difference)} className="cursor-pointer font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                      查看原文定位
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </article>
                          ))}
                          {filteredDifferences.length === 0 ? (
                            <HorizonEmptyState
                              Icon={FileSearch}
                              title="当前筛选下没有差异"
                              description="切换回全部差异，继续完成版本复核。"
                              action={<Button type="button" size="sm" variant="outline" onClick={() => setDifferenceFilter("all")}>查看全部差异</Button>}
                            />
                          ) : null}
                        </div>
                      </div>
                      </TabsContent>

                      <TabsContent value="summary" className="m-0 space-y-4 p-4 sm:p-5">
                        <div className={cn(
                          "rounded-2xl border p-4",
                          aiGenerationMode === "ai" ? "border-blue-200 bg-blue-50/60" : "border-amber-200 bg-amber-50/70",
                        )}>
                          <div className="flex items-start gap-3">
                            <div className={cn("rounded-xl bg-white p-2 shadow-sm", aiGenerationMode === "ai" ? "text-blue-700" : "text-amber-700")}>
                              {aiGenerationMode === "ai" ? <Sparkles className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className={cn("text-balance text-sm font-semibold", aiGenerationMode === "ai" ? "text-blue-950" : "text-amber-950")}>
                                  {aiGenerationMode === "ai" ? "AI 生成的版本变更摘要" : "规则降级生成的版本变更摘要"}
                                </h3>
                                <span className={cn(
                                  "rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                                  aiGenerationMode === "ai" ? "bg-blue-100 text-blue-700 ring-blue-200" : "bg-amber-100 text-amber-800 ring-amber-200",
                                )}>
                                  {aiGenerationMode === "ai" ? "AI 已生效" : "AI 未生效"}
                                </span>
                              </div>
                              <p className={cn("mt-1 text-pretty text-xs leading-5", aiGenerationMode === "ai" ? "text-blue-800/80" : "text-amber-900/80")}>
                                {aiGenerationMode === "ai"
                                  ? "摘要由已配置模型生成，会随差异复核结果更新，归档前可由用户编辑补充。"
                                  : aiWarning || "AI 当前不可用，本摘要由确定性规则生成，可继续人工编辑后归档。"}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="external-doc-summary" className="text-xs font-semibold text-slate-700">归档摘要</Label>
                          <Textarea
                            id="external-doc-summary"
                            value={summary}
                            onChange={(event) => setSummary(event.target.value)}
                            rows={7}
                            disabled={comparisonStatus === "archived"}
                            className="min-h-40 rounded-xl border-slate-200 bg-white text-sm leading-6 text-slate-700 disabled:bg-slate-50"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {[
                            { label: "高风险变化", value: differences.filter((item) => item.risk === "high").length, helper: "需重点人工确认", tone: "text-rose-700 bg-rose-50" },
                            { label: "内容变化", value: differences.filter((item) => item.type !== "format").length, helper: "新增 / 修改 / 删除", tone: "text-blue-700 bg-blue-50" },
                            { label: "版式变化", value: differences.filter((item) => item.type === "format").length, helper: "AI 判定为格式变化", tone: "text-slate-700 bg-slate-100" },
                          ].map((item) => (
                            <div key={item.label} className={cn("rounded-xl p-3", item.tone)}>
                              <p className="text-xs font-semibold">{item.label}</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
                              <p className="text-[11px] opacity-80">{item.helper}</p>
                            </div>
                          ))}
                        </div>
                        {comparisonStatus === "archived" ? (
                          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-500" role="status">
                            <LockKeyhole className="h-4 w-4" />
                            该版本已归档锁定，摘要不可重新生成
                          </div>
                        ) : (
                          <Button variant="unstyled"
                            type="button"
                            onClick={() => void handleRegenerateSummary()}
                            disabled={isActionPending}
                            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {isActionPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            根据复核结果重新生成
                          </Button>
                        )}
                      </TabsContent>

                      <TabsContent value="history" className="m-0 space-y-4 p-4 sm:p-5">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><ShieldCheck className="h-4 w-4 text-emerald-600" />证据已固化</span>
                            {/* 后端存的是 0–1 的置信度，直接拼 % 会显示成「0.988%」 */}
                            <span className="text-slate-500">OCR {ocrProvider ? `${ocrProvider}${ocrConfidence == null ? "" : ` · ${(ocrConfidence * 100).toFixed(1)}%`}` : "未触发（原生文本）"}</span>
                            <span className={cn("font-medium", aiGenerationMode === "ai" ? "text-blue-700" : "text-amber-700")}>
                              {aiGenerationMode === "ai" ? "AI 模型生成" : "规则降级生成"} · {aiModel || integration?.ai.model || "未配置"} · 识别 {differences.length} 处
                            </span>
                            <span className="font-mono text-blue-700">{compareJobId}</span>
                          </div>
                          {aiGenerationMode === "fallback" && aiWarning && (
                            <p className="mt-2 text-xs leading-5 text-amber-700" role="status">{aiWarning}</p>
                          )}
                        </div>
                        <div>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><History className="h-4 w-4 text-blue-700" />版本记录</h3>
                            <span className="text-[11px] text-slate-500">文件哈希 · 上传人 · 比对任务</span>
                          </div>
                          <div className="relative space-y-3 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-slate-200">
                            {displayedVersions.map((version) => (
                              <div key={version.id} className="relative flex gap-3">
                                <div className={cn(
                                  "relative z-10 mt-1 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-4 border-white",
                                  version.status === "pending" ? "bg-amber-500" : version.status === "failed" ? "bg-rose-500" : version.status === "current" ? "bg-emerald-500" : "bg-slate-300",
                                )}>
                                  {version.status === "current" && <Check className="h-3 w-3 text-white" />}
                                </div>
                                <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs font-bold text-slate-900">{version.version}</span>
                                    <span className={cn(
                                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                      version.status === "pending" ? "bg-amber-50 text-amber-700" : version.status === "failed" ? "bg-rose-50 text-rose-700" : version.status === "current" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
                                    )}>
                                      {version.status === "pending" ? "待确认" : version.status === "failed" ? "比对失败" : version.status === "current" ? "当前有效" : "历史版本"}
                                    </span>
                                    {version.uploadRevision > 1 && (
                                      <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-blue-700">当前修订 R{version.uploadRevision}</span>
                                    )}
                                    <span className="ml-auto text-[11px] text-slate-500">{version.uploadedAt}</span>
                                    <Button variant="unstyled"
                                      type="button"
                                      onClick={() => void openVersionFile(version)}
                                      disabled={openingVersionId === `${version.id}:${version.uploadRevision}`}
                                      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-primary/25 hover:text-primary-hover disabled:cursor-wait disabled:opacity-60"
                                      title={`下载当前文件修订 R${version.uploadRevision}`}
                                    >
                                      {openingVersionId === `${version.id}:${version.uploadRevision}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                      下载
                                    </Button>
                                  </div>
                                  <p className="mt-2 truncate text-xs font-medium text-slate-800" title={version.fileName}>{version.fileName}</p>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                                    <span>{version.size}</span><span>{version.uploadedBy}</span><span className="font-mono">{version.hash}</span>
                                    {version.compareId && <span className="font-semibold text-blue-700">{version.compareId}</span>}
                                  </div>
                                  {version.replacementHistory.length > 0 && (
                                    <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-2.5">
                                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
                                        <History className="h-3.5 w-3.5" />上传纠正记录 {version.replacementHistory.length} 条
                                      </p>
                                      <div className="mt-2 space-y-2">
                                        {[...version.replacementHistory].reverse().map((replacement) => {
                                          const openingReplacementId = `${version.id}:${replacement.revision}`;
                                          return (
                                            <div key={replacement.revision} className="rounded-lg border border-slate-200 bg-white p-2.5">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">旧修订 R{replacement.revision}</span>
                                                <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800" title={replacement.fileName}>{replacement.fileName}</p>
                                                <Button variant="unstyled"
                                                  type="button"
                                                  onClick={() => void openVersionFile(version, replacement.revision)}
                                                  disabled={openingVersionId === openingReplacementId}
                                                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-primary/25 hover:text-primary-hover disabled:cursor-wait disabled:opacity-60"
                                                  title={`打开旧文件修订 R${replacement.revision}`}
                                                >
                                                  {openingVersionId === openingReplacementId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                                  旧文件
                                                </Button>
                                              </div>
                                              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-slate-500">
                                                <span>{replacement.size}</span><span>{replacement.uploadedBy} · {replacement.uploadedAt}</span><span className="font-mono">{replacement.hash}</span>
                                              </div>
                                              <p className="mt-1.5 text-[10px] leading-4 text-slate-600">纠正原因：{replacement.reason} · {replacement.replacedBy} 于 {replacement.replacedAt} 替换</p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TabsContent>

                      </div>
                    </Tabs>

                    <div className="flex shrink-0 flex-col justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                      <div className="flex items-center gap-3">
                        <div className={cn("flex h-9 w-9 items-center justify-center rounded-full", allReviewed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                          {allReviewed ? <CheckCircle2 className="h-5 w-5" /> : <CircleDot className="h-5 w-5" />}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{reviewedCount}/{differences.length} 处差异已人工复核</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">全部确认后方可锁定并归档新版本</p>
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            disabled={comparisonStatus !== "review" || !allReviewed || isActionPending}
                            className="hz-primary-action"
                          >
                            {comparisonStatus === "archived" ? <LockKeyhole className="size-4" /> : <Archive className="size-4" />}
                            {comparisonStatus === "archived" ? "已确认归档" : "确认差异并归档"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="horizon-portal">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-balance text-[#1b2559]">确认归档 {candidateVersion}？</AlertDialogTitle>
                            <AlertDialogDescription className="text-pretty">
                              归档后候选版本将设为当前有效版本，差异复核结果与摘要会被锁定。请确认所有证据已核对完成。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>返回检查</AlertDialogCancel>
                            <AlertDialogAction className="hz-primary-action" onClick={() => void handleArchive()}>
                              <Archive className="size-4" />
                              确认并归档
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </>
                )}
              </>
            )}
          </section>

        </div>
      </div>

      {evidenceDifference && baselineRecord && candidateRecord && (
        <ExternalDocumentEvidenceViewer
          difference={evidenceDifference}
          baseline={{
            id: baselineRecord.id,
            version: baselineRecord.version,
            fileName: baselineRecord.fileName,
          }}
          candidate={{
            id: candidateRecord.id,
            version: candidateRecord.version,
            fileName: candidateRecord.fileName,
          }}
          onClose={() => setEvidenceDifference(null)}
        />
      )}

      <Dialog open={showUpload} onOpenChange={(open) => { if (!open) closeUploadDialog(); }}>
        <DialogContent
          className="horizon-portal flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          onEscapeKeyDown={(event) => { if (isUploading) event.preventDefault(); }}
          onInteractOutside={(event) => { if (isUploading) event.preventDefault(); }}
        >
            <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 pr-12 sm:px-6 sm:pr-12">
              <DialogTitle className="text-balance text-lg text-[#1b2559]">
                {uploadMode === "replaceCandidate" ? "纠正候选文件" : "上传资料文件"}
              </DialogTitle>
              <DialogDescription className="text-pretty">
                {uploadMode === "replaceCandidate" ? "替换本次待比对文件，业务版本与比对任务保持不变。" : "建立首版资料，或为已有资料上传待比对的新版本。"}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              {uploadMode !== "replaceCandidate" && <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1" aria-label="上传类型">
                <Button variant="unstyled"
                  type="button"
                  aria-pressed={uploadMode === "newDocument"}
                  onClick={() => {
                    setUploadMode("newDocument");
                    setUploadVersion("V1.0");
                    setUploadCategory("产品资料");
                    setUploadError("");
                  }}
                  className={cn("cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", uploadMode === "newDocument" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                >
                  新建资料首版
                </Button>
                <Button variant="unstyled"
                  type="button"
                  aria-pressed={uploadMode === "newVersion"}
                  onClick={() => {
                    if (!hasDocuments) return;
                    setUploadMode("newVersion");
                    setUploadVersion(nextVersion(selectedDocument.currentVersion));
                    setUploadCategory(selectedDocument.category);
                    setUploadError("");
                  }}
                  disabled={!hasDocuments}
                  className={cn("cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", uploadMode === "newVersion" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                >
                  上传已有资料新版本
                </Button>
              </div>}

              {uploadMode === "newVersion" && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5">
                  <p className="text-xs font-semibold text-blue-900">比对基准</p>
                  <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{selectedDocument.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{selectedDocument.currentFile}</p>
                    </div>
                    <span className="self-start rounded-lg bg-white px-2.5 py-1 font-mono text-xs font-bold text-blue-700 ring-1 ring-inset ring-blue-200 sm:self-auto">当前 {selectedDocument.currentVersion}</span>
                  </div>
                </div>
              )}

              {uploadMode === "replaceCandidate" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5" role="alert">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-amber-900">将替换当前候选文件</p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={candidateFileName}>{candidateFileName}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        当前为 {candidateVersion} · 文件修订 R{candidateRecord?.uploadRevision ?? 1}。替换后会清空现有复核结果并重新执行 AI / OCR 比对。
                      </p>
                    </div>
                    <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-mono text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200">{compareJobId}</span>
                  </div>
                </div>
              )}

              {uploadMode !== "replaceCandidate" && <div className="grid gap-4 sm:grid-cols-2">
                {uploadMode === "newDocument" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="external-doc-name" className="text-xs font-semibold text-slate-700">资料名称 <span className="text-rose-600">*</span></Label>
                    <Input id="external-doc-name" value={newDocumentName} onChange={(event) => { setNewDocumentName(event.target.value); setUploadError(""); }} placeholder="例如：CPAP 产品彩页" className="h-10 rounded-xl border-slate-200" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="external-doc-version" className="text-xs font-semibold text-slate-700">版本号 <span className="text-rose-600">*</span></Label>
                  <Input id="external-doc-version" value={uploadVersion} onChange={(event) => { setUploadVersion(event.target.value); setUploadError(""); }} placeholder="例如：V3.2" className="h-10 rounded-xl border-slate-200 font-mono" />
                </div>
                {uploadMode === "newDocument" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="external-doc-category" className="text-xs font-semibold text-slate-700">资料分类</Label>
                    <NativeSelect id="external-doc-category" value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} className="h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25">
                      <option>产品资料</option><option>技术资料</option><option>合规资质</option><option>注册资料</option><option>售前资料</option><option>未分类</option>
                    </NativeSelect>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700">资料分类（沿用）</div>
                    <div className="flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600" aria-label="沿用当前资料分类" role="status">
                      {selectedDocument.category}
                    </div>
                  </div>
                )}
              </div>}

              <Label
                htmlFor="external-doc-file"
                className="block cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center transition-colors hover:border-primary hover:bg-accent/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectUploadFile(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <Input id="external-doc-file" type="file" className="sr-only" accept=".pdf,.docx,.xls,.xlsx,.pptx,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.webp,.bmp" onChange={handleFileChange} />
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-3 text-left">
                    <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700"><FileCheck2 className="h-6 w-6" /></div>
                    <div className="min-w-0">
                      <p className="max-w-sm truncate text-sm font-semibold text-slate-900">{uploadFile.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{fileSizeLabel(uploadFile.size)} · 点击可重新选择</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <CloudUpload className="mx-auto h-8 w-8 text-blue-700" />
                    <p className="mt-3 text-sm font-semibold text-slate-900">点击选择或拖放资料文件</p>
                    <p className="mt-1 text-xs text-slate-500">支持 PDF、DOCX、表格、PPTX、文本和图片，单文件不超过 25 MB</p>
                  </>
                )}
              </Label>

              <div className="space-y-1.5">
                <Label htmlFor="external-doc-note" className="text-xs font-semibold text-slate-700">{uploadMode === "replaceCandidate" ? "纠正原因" : "上传说明"}</Label>
                <Textarea
                  id="external-doc-note"
                  value={uploadNote}
                  onChange={(event) => { setUploadNote(event.target.value); setUploadError(""); }}
                  rows={3}
                  maxLength={500}
                  placeholder={uploadMode === "replaceCandidate" ? "例如：上一份文件选错，现替换为已审核的正式文件…" : "填写版本来源、修改原因或需要重点核对的内容…"}
                  className="min-h-24 rounded-xl border-slate-200"
                />
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-700 text-white"><Check className="h-3.5 w-3.5" /></div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    {uploadMode === "replaceCandidate" ? "错误文件不会被覆盖或删除" : uploadMode === "newVersion" ? "上传完成后自动启动 AI / OCR 比对" : "首版文件将直接建立受控档案"}
                  </p>
                  <p className="mt-1 text-pretty text-xs leading-5 text-slate-500">
                    {uploadMode === "replaceCandidate" ? "旧文件、SHA256、上传人、上传时间和纠正原因会保存在版本溯源中，仍可下载核验。" : `系统保留原始文件、SHA256、上传人和时间。AI ${integration?.ai.configured ? `已配置 ${integration.ai.model || "默认模型"}` : "尚未配置"}；OCR ${integration?.ocr.configured ? "已配置腾讯 OCR" : "尚未配置"}。`}
                  </p>
                </div>
              </div>

              {uploadError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-pretty text-sm text-rose-700" role="alert">
                  {uploadError}
                </div>
              ) : null}
            </div>

            <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" onClick={closeUploadDialog} disabled={isUploading}>取消</Button>
              <Button type="button" onClick={handleUpload} disabled={isUploading} className="hz-primary-action">
                {isUploading ? <Loader2 className="size-4 animate-spin" /> : uploadMode === "replaceCandidate" ? <RefreshCw className="size-4" /> : uploadMode === "newVersion" ? <FileDiff className="size-4" /> : <Archive className="size-4" />}
                {isUploading ? "正在上传…" : uploadMode === "replaceCandidate" ? "替换并重新比对" : uploadMode === "newVersion" ? "上传并开始比对" : "上传并建立首版"}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
