/**
 * 问题记录与 AI 定位 — 新建问题抽屉（右侧滑入）。
 *
 * 两步：①表单 → 提交时 service.create + service.findSimilar；②查相似结果。
 * 命中可「复用此方案」(adopt reuse)；可「查看详情」(打开历史问题)；
 * 都不匹配 → service.analyze(新问题) 触发完整根因分析后打开新问题详情。
 * 使用项目 Sheet 原语处理遮罩、Esc、焦点约束与关闭后的焦点归还。
 */
import * as React from "react";
import { toast } from "sonner";
import { Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { cn } from "../components/ui/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import {
  type Issue,
  type IssueService,
  type NewIssueInput,
  type SimilarMatch,
} from "../lib/issue/types";
import { Mono, SolutionTypeBadge, SourceTag } from "./badges";
import { t, useI18n } from "../lib/i18n";
import { Textarea } from "../components/ui/textarea";

type DraftAttachment = NonNullable<NewIssueInput["attachments"]>[number];

/** 读文件为 base64 dataURL（图片与文档都需要，用于真实上传为二进制）。 */
function fileToDataUrl(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

type Step = "form" | "similar";

const emptyForm = {
  title: "",
  description: "",
};

export function NewIssueDrawer({
  service,
  open,
  returnFocusRef,
  onClose,
  onOpen,
}: {
  service: IssueService;
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  useI18n();

  const [step, setStep] = React.useState<Step>("form");
  const [form, setForm] = React.useState(emptyForm);
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  const [submitting, setSubmitting] = React.useState(false);
  const [createdIssue, setCreatedIssue] = React.useState<Issue | null>(null);
  const [matches, setMatches] = React.useState<SimilarMatch[]>([]);
  const [busyAction, setBusyAction] = React.useState<string | null>(null);

  // 打开时重置全部状态。
  React.useEffect(() => {
    if (open) {
      setStep("form");
      setForm(emptyForm);
      setAttachments([]);
      setUploading(false);
      setTouched(false);
      setSubmitting(false);
      setCreatedIssue(null);
      setMatches([]);
      setBusyAction(null);
    }
  }, [open]);

  const titleOk = form.title.trim().length > 0;
  const descOk = form.description.trim().length > 0;
  // 标题 / 描述 / 附件为「或」关系：任意其一有内容即可进行 AI 分析。
  const formValid = titleOk || descOk || attachments.length > 0;

  // 标题为空时兜底：取描述首句 → 附件名 → 占位，保证问题记录始终有可读标题。
  const fallbackTitle = (): string => {
    const desc = form.description.trim().replace(/\s+/g, " ");
    if (desc) return desc.slice(0, 50);
    const firstAttachment = attachments[0]?.fileName?.trim();
    if (firstAttachment) return firstAttachment;
    return t("未命名问题");
  };

  const buildInput = (): NewIssueInput => ({
    title: form.title.trim() || fallbackTitle(),
    description: form.description.trim(),
    // 来源/严重度/产品等不再在表单收集；后端会给来源/严重度兜底默认值。
    // attachments 仅传后端 DTO 允许字段（forbidNonWhitelisted），剥离 uploadedBy/uploadedAt；
    // 不回传 fileUrl（那是 base64 dataURL，体积大且后端按 id 重算预览链接）。
    attachments: attachments.length
      ? attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          fileType: a.fileType,
          extractedText: a.extractedText,
        }))
      : undefined,
  });

  // 真实上传：每个文件读成 dataURL → service.uploadAttachment（落 OSS/FileAsset）→
  // processAttachment 抽取文本，拿到带 id 的 Attachment，提交时随问题入库，首版 AI 分析即可见证据。
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.size > 0);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const uploaded: DraftAttachment[] = [];
      for (const f of list) {
        const dataUrl = await fileToDataUrl(f);
        const raw = await service.uploadAttachment({
          fileName: f.name,
          fileType: f.type || "application/octet-stream",
          size: f.size,
          dataUrl,
        });
        uploaded.push(await service.processAttachment(raw, "ai"));
      }
      setAttachments((cur) => [...cur, ...uploaded]);
      toast.success(t("已上传 {count} 个附件", { count: uploaded.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("附件上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const goSimilar = async () => {
    setTouched(true);
    if (!formValid || submitting) return;
    setSubmitting(true);
    try {
      const input = buildInput();
      const issue = await service.create(input);
      const found = await service.findSimilar(input);
      // 没有相似历史问题时，跳过空白的「查相似」步骤，直接进入详情由 AI 自动分析。
      if (found.length === 0) {
        onClose();
        onOpen(issue.id);
        return;
      }
      setCreatedIssue(issue);
      setMatches(found);
      setStep("similar");
    } finally {
      setSubmitting(false);
    }
  };

  const reuse = async (match: SimilarMatch) => {
    if (!createdIssue || busyAction) return;
    setBusyAction(`reuse:${match.issue.id}`);
    try {
      await service.adopt(createdIssue.id, {
        kind: "reuse",
        reusedFrom: match.issue.id,
      });
      const id = createdIssue.id;
      onClose();
      onOpen(id);
    } finally {
      setBusyAction(null);
    }
  };

  // 不再手动触发分析：进入详情后由 DetailView 自动生成根因（见 DetailView 的 auto-kick）。
  const enterDetail = () => {
    if (!createdIssue || busyAction) return;
    const id = createdIssue.id;
    onClose();
    onOpen(id);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        side="right"
        data-step={step}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = returnFocusRef.current;
          if (opener?.isConnected) opener.focus();
        }}
        className="horizon-portal rd-horizon-issue-drawer rd-horizon-issue-drawer-surface w-full gap-0 border-l border-[#e9edf7] bg-white p-0 transition-none data-[state=closed]:animate-none data-[state=open]:animate-none sm:max-w-2xl"
      >
        <SheetHeader className="rd-horizon-issue-drawer-header border-b border-[#e9edf7] px-5 py-4 pr-14 text-left">
          <SheetTitle className="text-base font-semibold text-[#1b2559] text-balance">
            {t("新建问题")}
          </SheetTitle>
          <SheetDescription className="text-xs text-[#64748b] text-pretty">
            {step === "form" ? t("第 1 步 · 填写问题") : t("第 2 步 · 查相似方案")}
          </SheetDescription>
        </SheetHeader>

        <div className="rd-horizon-issue-drawer-body flex-1 overflow-y-auto px-5 py-4">
          {step === "form" ? (
            <FormStep
              form={form}
              setForm={setForm}
              attachments={attachments}
              setAttachments={setAttachments}
              uploading={uploading}
              invalid={touched && !formValid}
              dragOver={dragOver}
              setDragOver={setDragOver}
              onFiles={handleFiles}
            />
          ) : (
            <SimilarStep
              matches={matches}
              busyAction={busyAction}
              onReuse={reuse}
              onViewDetail={(id) => onOpen(id)}
            />
          )}
        </div>

        <SheetFooter className="rd-horizon-issue-drawer-footer block border-t border-[#e9edf7] px-5 py-4">
          {step === "form" ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("取消")}
              </Button>
              <Button className="hz-primary-action" onClick={goSimilar} disabled={submitting || uploading}>
                {submitting || uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {uploading ? t("附件上传中…") : t("下一步：查相似")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={enterDetail}
              disabled={!!busyAction}
            >
              <Sparkles className="size-4" />
              {t("以上都不匹配 → 进入详情（AI 自动分析）")}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 1 — 表单
// ────────────────────────────────────────────────────────────────────────────
function Field({
  label,
  required,
  error,
  group = false,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-500">{error}</span> : null}
    </>
  );
  if (group) {
    return <div className="rd-horizon-issue-drawer-field" role="group" aria-label={label}>{content}</div>;
  }
  return (
    <label className="rd-horizon-issue-drawer-field block">
      {content}
    </label>
  );
}

function FormStep({
  form,
  setForm,
  attachments,
  setAttachments,
  uploading,
  invalid,
  dragOver,
  setDragOver,
  onFiles,
}: {
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  attachments: DraftAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<DraftAttachment[]>>;
  uploading: boolean;
  invalid: boolean;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onFiles: (files: FileList | null) => void;
}) {
  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="rd-horizon-issue-drawer-form-section space-y-4">
      {/* 标题 / 描述 / 附件为「或」关系：任意其一填写即可，无需全部填写。 */}
      <p className="rd-horizon-issue-drawer-note rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500 text-pretty">
        {t("标题、描述、附件")} {" "}<span className="font-medium text-slate-600">{t("任填其一")}</span>{" "}{t("即可开始 AI 分析。")}
      </p>
      {invalid ? (
        <p className="text-xs text-red-500">{t("请至少填写标题、描述，或上传附件其中之一。")}</p>
      ) : null}

      <Field label={t("标题")}>
        <Input
          data-autofocus
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={t("一句话描述问题现象（可留空）")}
        />
      </Field>

      <Field label={t("描述")}>
        <Textarea
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          rows={4}
          placeholder={t("现象 / 复现条件 / 影响范围…")}
          className="flex w-full rounded-md border border-input bg-input-background px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </Field>

      {/* 附件（选填，但与标题/描述互为「或」） */}
      <Field label={t("附件（选填）")} group>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "rd-horizon-issue-drawer-dropzone flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
            dragOver
              ? "border-primary bg-accent"
              : "border-slate-300",
          )}
        >
          {uploading ? (
            <Loader2 className="size-5 animate-spin text-primary" />
          ) : (
            <Paperclip className="size-5 text-muted-foreground" />
          )}
          <p className="text-xs text-slate-500">
            {t("拖拽文件到此，或")}{" "}
            <label className="rd-horizon-issue-file-picker ml-1 cursor-pointer font-medium text-primary hover:underline">
              {t("点击选择")}
              <Input
                type="file"
                multiple
                disabled={uploading}
                className="sr-only"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {uploading ? t("正在上传…") : t("支持图片与文档，上传后 AI 首版分析即可结合附件内容")}
          </p>
        </div>
        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {attachments.map((a, i) => (
              <li
                key={`${a.fileName}-${i}`}
                className="rd-horizon-issue-drawer-attachment flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
              >
                <span className="truncate text-slate-600">
                  {a.fileName}
                </span>
                <Button variant="unstyled"
                  type="button"
                  aria-label={t("移除附件")}
                  onClick={() =>
                    setAttachments((cur) => cur.filter((_, idx) => idx !== i))
                  }
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-slate-200 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Field>

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2 — 查相似结果
// ────────────────────────────────────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const r = 16;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="rd-horizon-issue-similarity-score relative size-11 shrink-0">
      <svg viewBox="0 0 40 40" className="size-11 -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          className="stroke-slate-200"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="stroke-primary"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <Mono className="text-xs font-semibold text-primary">
          {pct}
        </Mono>
      </span>
    </div>
  );
}

function SimilarStep({
  matches,
  busyAction,
  onReuse,
  onViewDetail,
}: {
  matches: SimilarMatch[];
  busyAction: string | null;
  onReuse: (m: SimilarMatch) => void;
  onViewDetail: (id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
        <Sparkles className="size-7 text-muted-foreground" />
        <p className="text-sm text-slate-500">
          {t("未找到相似的历史问题")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("可直接让 AI 做完整根因分析（见下方按钮）")}
        </p>
      </div>
    );
  }

  return (
    <div className="rd-horizon-issue-similar-list space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("命中")} <Mono>{matches.length}</Mono> {t("条历史问题，可直接复用其方案：")}
      </p>
      {matches.map((m) => {
        const reuseBusy = busyAction === `reuse:${m.issue.id}`;
        return (
          <div
            key={m.issue.id}
            className="rd-horizon-issue-similar-card rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <ScoreRing score={m.score} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Mono className="text-[11px] text-muted-foreground">{m.issue.id}</Mono>
                  <SourceTag value={m.issue.source} />
                </div>
                <div className="mt-0.5 line-clamp-2 text-sm font-medium text-slate-800">
                  {m.issue.title}
                </div>
              </div>
            </div>

            {m.adoptedSolution ? (
              <div className="rd-horizon-issue-similar-solution mt-2 rounded-lg border border-[#dce6ff] bg-accent p-2.5">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-primary">
                    {t("采纳方案")}
                  </span>
                  <SolutionTypeBadge value={m.adoptedSolution.type} />
                </div>
                <p className="text-xs text-slate-500">
                  {t("根因：")}{m.adoptedSolution.cause}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {m.adoptedSolution.action}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t("该历史问题暂无采纳方案。")}</p>
            )}

            <div className="mt-2.5 flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onReuse(m)}
                disabled={!!busyAction || !m.adoptedSolution}
              >
                {reuseBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("复用此方案")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => onViewDetail(m.issue.id)}
                disabled={!!busyAction}
              >
                {t("查看详情")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
