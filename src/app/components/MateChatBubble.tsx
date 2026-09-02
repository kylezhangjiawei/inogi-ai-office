import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  PencilLine,
  Pin,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { authFetch } from "../lib/authSession";
import { i18nLocale, t, useI18n } from "../lib/i18n";
import { compressImageFile } from "../lib/resourceImage";
import { uploadResourceFile } from "../lib/resourceUpload";
import { useAuth } from "../auth";
import { cn } from "./ui/utils";
import { MATECHAT_OPEN_EVENT, notifyMateChatActivity } from "./matechat/openMateChat";
import { useNavigate } from "react-router";
import { backfillKbToRag, ragStatus, type RagCitation, type RagStatus } from "../lib/ragApi";
import { sendRdMessage } from "../lib/rdApi";
import { isChatUsableModel } from "../lib/aiModelOptions";
import { hasPermission } from "../lib/permissions";
import { RagCitations, RagPermissionNotice } from "./RagCitations";
import { MobileImagePreviewLink } from "./MobileZoomableImage";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type ApiConversation = {
  id: string;
  title: string;
  summary: string;
  pinned: boolean;
  updatedAt: string;
  _count?: { messages: number };
};

/** 后端 getMessages 返回的附件视图（带同源内联预览 URL） */
type AttachmentView = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  url: string | null;
  thumbnailUrl?: string | null;
  isImage: boolean;
};

type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  reaction: string | null;
  feedback?: {
    reaction: string;
    reasons: string[];
    comment: string;
    status: string;
  } | null;
  attachments?: AttachmentView[];
  /** assistant 消息的 ReAct 工具步骤终态（后端落库，历史回放用；存量消息为 null） */
  toolSteps?: ToolStep[] | null;
  sources?: Array<"db" | "rag" | "web" | "attachment" | "ai">;
  createdAt: string;
};

/** 输入区待发送附件（上传中 / 完成 / 失败 三态） */
type PendingAttachment = {
  localId: string;
  name: string;
  size: number;
  mime: string;
  status: "compressing" | "uploading" | "done" | "error";
  fileId?: string;
  /** 图片本地 blob 预览（发送后乐观消息也复用它） */
  previewUrl?: string;
  error?: string;
};

type ModelOption = { id: string; label: string; provider: string; model: string; usage_kind?: string };

type SseEvent =
  | { type: "userMessage"; messageId: string }
  | { type: "context"; fromDb: boolean; fromRag?: boolean; fromWeb?: boolean; fromAttachment?: boolean }
  | { type: "citations"; citations: RagCitation[]; filteredByPermission: number }
  /** 回答完成后追加的引用（如「互联网参考」附录的联网来源），合并进已有引用卡 */
  | { type: "citations_extra"; citations: RagCitation[] }
  | { type: "delta"; delta: string }
  | { type: "modelSwitched"; from: string; to: string; reason: string }
  /** 流式期间有内容被服务端抑制（file-export 块）时，回答结束推最终正文覆盖显示 */
  | { type: "content_final"; content: string }
  /** 对话内生成的文件（Excel/Word），挂到 assistant 消息下方复用附件卡展示 */
  | { type: "files_generated"; attachments: AttachmentView[] }
  | { type: "done"; messageId: string; title?: string }
  /** 首字之前的阶段提示（检索中/思考中…），收到第一个 delta 后前端自行清掉 */
  | { type: "status"; label: string }
  /** ReAct 工具调用步骤：running 先到，同 callId 的 ok/error 原位更新 */
  | {
      type: "tool_step";
      callId: string;
      tool: string;
      label: string;
      status: "running" | "ok" | "error";
      detail?: string;
      thought?: string;
      args?: string;
      output?: string;
    }
  /** ReAct 写操作待确认动作卡（用户点确认/取消走 /chat/actions 端点） */
  | { type: "pending_action"; action: PendingActionCard }
  | { type: "error"; message: string };

/** assistant 消息附加的引用数据，由 'citations' SSE 事件填充 */
type MessageCitations = { citations: RagCitation[]; filteredByPermission: number };

/**
 * assistant 消息的工具调用步骤。流式期间由 'tool_step' SSE 事件填充，
 * 历史回放时由 ChatMessage.toolSteps 水合——两条来源同形，共用同一套渲染。
 */
type ToolStep = {
  callId: string;
  tool: string;
  label: string;
  status: "running" | "ok" | "error";
  detail?: string;
  /** 模型调用这个工具的理由（ReAct 的 Thought），随 tool_call 参数一起到达 */
  thought?: string;
  /** 模型传给工具的参数，展开面板用（后端已截断） */
  args?: string;
  /** 工具回给模型的观察值，展开面板用（后端已截断） */
  output?: string;
};

/**
 * 会把「具体任务」的标识/状态带进回答正文的工具。
 * 分享给同事时，若回答用到了这些工具，正文可能含收件人（仅能看自己任务）无权查看的任务数据，
 * 故先给发送者一次确认。search_knowledge / query_members / 生图改图不涉及任务，不在此列。
 */
const TASK_REF_TOOLS = new Set([
  "query_tasks",
  "get_dashboard_summary",
  "create_task",
  "update_task_progress",
  "approve_task_review",
  "send_reminder",
]);

/** 后端下发的待确认动作卡数据 */
type PendingActionCard = {
  id: string;
  tool: string;
  label: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  expiresAt: string;
};

/** 确认卡的前端状态：pending 显示确认/取消按钮，其余显示结果 */
type PendingActionView = PendingActionCard & {
  status: "pending" | "submitting" | "executed" | "canceled" | "failed";
  resultMessage?: string;
};

type DeleteConfirm =
  | { kind: "conversation"; id: string; label: string }
  | { kind: "message"; id: string }
  | null;

type FeedbackDraft = {
  messageId: string;
  reasons: string[];
  comment: string;
} | null;

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const FLOATING_MARGIN = 24;
const FLOATING_BOTTOM_SAFE_AREA = 88;
const FLOATING_FALLBACK_SIZE = { width: 224, height: 72 };
const AI_AVATAR = "https://matechat.gitcode.com/logo.svg";

const QUICK_PROMPTS = [
  "帮我整理今天的关键待办",
  "帮我起草一封客户跟进邮件",
  "总结当前项目的风险点",
  "给我一份合同审查意见模板",
];

const DISLIKE_REASONS = [
  { value: "inaccurate", label: "回答不准确" },
  { value: "unresolved", label: "没有解决问题" },
  { value: "outdated", label: "数据不完整或过期" },
  { value: "misunderstood", label: "没有理解问题" },
  { value: "slow", label: "响应太慢" },
  { value: "inconvenient", label: "操作不方便" },
  { value: "other", label: "其他" },
] as const;

/** 附件数量与单文件大小上限（与后端 uploads-temp 的 20MB 对齐） */
const ATTACH_MAX_COUNT = 10;
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
/**
 * 图片上传前压缩的触发/目标上限：对齐后端聊天视觉硬线（MAX_IMAGE_BYTES = 10MB），留 1MB 余量。
 * 超过此值的图片一律先压缩再上传，否则后端会以「图片过大」拒绝加载、模型看不到图。
 */
const IMAGE_UPLOAD_MAX_BYTES = 9 * 1024 * 1024;

function fmtFileSize(bytes: number) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 是否图片：优先看 MIME，缺失时回退看扩展名（粘贴/拖拽偶尔丢失 type） */
function isImageFile(file: File): boolean {
  if ((file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || "");
}

async function compressImageToLimit(file: File, maxBytes: number): Promise<File | null> {
  return compressImageFile(file, {
    triggerBytes: maxBytes,
    targetBytes: maxBytes,
    hardLimitBytes: maxBytes,
    maxEdge: 2560,
    minEdge: 480,
    outputType: "image/jpeg",
    qualities: [0.82, 0.7, 0.6, 0.5],
    background: "#ffffff",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(i18nLocale(), { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(i18nLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDefaultFloatingPosition(element?: HTMLElement | null) {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  const width = element?.offsetWidth || FLOATING_FALLBACK_SIZE.width;
  const height = element?.offsetHeight || FLOATING_FALLBACK_SIZE.height;

  return {
    x: Math.max(FLOATING_MARGIN, window.innerWidth - width - FLOATING_MARGIN),
    y: Math.max(FLOATING_MARGIN, window.innerHeight - height - FLOATING_BOTTOM_SAFE_AREA),
  };
}

// ─── API 层 ───────────────────────────────────────────────────────────────────

async function apiListConversations(): Promise<ApiConversation[]> {
  const res = await authFetch("/api/chat/conversations");
  if (!res.ok) throw new Error("加载对话列表失败");
  return res.json() as Promise<ApiConversation[]>;
}

async function apiCreateConversation(): Promise<ApiConversation> {
  const res = await authFetch("/api/chat/conversations", { method: "POST", body: JSON.stringify({}) });
  if (!res.ok) throw new Error("新建对话失败");
  return res.json() as Promise<ApiConversation>;
}

async function apiUpdateConversation(
  id: string,
  data: { title?: string; pinned?: boolean },
): Promise<ApiConversation> {
  const res = await authFetch(`/api/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("更新失败");
  return res.json() as Promise<ApiConversation>;
}

async function apiDeleteConversation(id: string): Promise<void> {
  const res = await authFetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除失败");
}

async function apiGetMessages(convId: string): Promise<ApiMessage[]> {
  const res = await authFetch(`/api/chat/conversations/${convId}/messages`);
  if (!res.ok) throw new Error("加载消息失败");
  return res.json() as Promise<ApiMessage[]>;
}

/** 拉取会话内仍待确认的动作卡（刷新后恢复），失败返回空不阻塞消息加载 */
async function apiGetPendingActions(convId: string): Promise<Array<{ messageId: string | null; card: PendingActionCard }>> {
  try {
    const res = await authFetch(`/api/chat/conversations/${convId}/pending-actions`);
    if (!res.ok) return [];
    return (await res.json()) as Array<{ messageId: string | null; card: PendingActionCard }>;
  } catch {
    return [];
  }
}

async function apiUpdateReaction(
  msgId: string,
  payload: { reaction: "like" | "dislike" | null; reasons?: string[]; comment?: string },
): Promise<void> {
  const res = await authFetch(`/api/chat/messages/${msgId}/reaction`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("提交反馈失败");
}

async function apiRecordUsageEvent(payload: {
  eventType: "chat_open" | "copy" | "share";
  conversationId?: string;
  messageId?: string;
  model?: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const res = await authFetch("/api/chat/events", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("使用行为记录失败");
}

async function apiDeleteMessage(msgId: string): Promise<void> {
  const res = await authFetch(`/api/chat/messages/${msgId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除消息失败");
}

type UploadResult = {
  fileId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  signedUrl: string | null;
  expiresIn: number;
};

/** 上传单个文件到通用文件接口（uploads-temp 桶，允许任意类型 ≤20MB），返回权威文件信息 */
async function apiUploadFile(file: File): Promise<UploadResult> {
  return uploadResourceFile(file, "uploads-temp");
}

async function apiListModels(): Promise<ModelOption[]> {
  const res = await authFetch("/api/chat/models");
  if (!res.ok) return [];
  const all = (await res.json()) as ModelOption[];
  // 仅保留可对话模型（文本/多模态）：用途判定复用共享的 isChatUsableModel
  //（usage_kind 权威 + 名称兜底），自动排除图片生成 / 向量 / 文档解析模型，
  // 后端已过滤，前端再加一层防护，且与其它页面共用同一套判定避免漂移。
  return all.filter((m) => isChatUsableModel(m));
}

// ─── assistant 正文 markdown 渲染 ─────────────────────────────────────────────

/** AI 回答的 markdown 渲染：GFM 表格/列表/代码块，紧凑聊天排版；用户消息仍走纯文本 */
const MarkdownContent = React.memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
        h1: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-bold first:mt-0">{children}</h3>,
        h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-base font-bold first:mt-0">{children}</h3>,
        h3: ({ children }) => <h4 className="mb-1 mt-2.5 text-sm font-bold first:mt-0">{children}</h4>,
        h4: ({ children }) => <h4 className="mb-1 mt-2.5 text-sm font-bold first:mt-0">{children}</h4>,
        ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-6">{children}</li>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-slate-500">{children}</blockquote>
        ),
        hr: () => <hr className="my-3 border-slate-200" />,
        pre: ({ children }) => (
          <pre className="my-2 overflow-x-auto rounded-lg bg-slate-800 p-3 text-xs leading-5 text-slate-100">{children}</pre>
        ),
        code: ({ children, ...rest }) => {
          // 块级代码在 pre 里（含换行），样式由 pre 承担；行内代码单独上底色
          const isBlock = String(children ?? "").includes("\n");
          return isBlock ? (
            <code {...rest}>{children}</code>
          ) : (
            <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.9em]" {...rest}>
              {children}
            </code>
          );
        },
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => <td className="border border-slate-200 px-2 py-1 align-top">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function MateChatBubble() {
  const { user } = useAuth();
  // KB 管理员才看得到「一键回填」入口（后端同样以 rd-kb:manage 鉴权，普通用户即便看到点击也会被 403 拦下）
  const canBackfillRag = hasPermission(user?.permissions ?? [], "rd-kb:manage");

  // 浮动气泡
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const movedRef = useRef(false);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });
  const [bubbleReady, setBubbleReady] = useState(false);
  // 球在右半屏时右缘锚定，hover 文字向左展开，避免展开部分超出视口被裁
  const [anchorRight, setAnchorRight] = useState(true);

  // 对话框
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();

  // 分享给同事：目标消息 + 收件人列表 + 搜索 + 发送态
  type ShareRecipient = { id: string; name: string; department: string | null };
  const [shareTarget, setShareTarget] = useState<ApiMessage | null>(null);
  const [shareRecipients, setShareRecipients] = useState<ShareRecipient[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareSendingId, setShareSendingId] = useState<string | null>(null);
  // 越权分享二次确认：待确认的收件人（回答含任务数据、对方可能无权查看时置入）
  const [shareConfirm, setShareConfirm] = useState<ShareRecipient | null>(null);

  // 搜索过滤 + 按部门分组：长列表下便于扫读，避免每行重复展示同一部门
  const shareGroups = useMemo(() => {
    const kw = shareSearch.trim().toLowerCase();
    const list = kw
      ? shareRecipients.filter(
          (r) => r.name.toLowerCase().includes(kw) || (r.department ?? "").toLowerCase().includes(kw),
        )
      : shareRecipients;
    const groups: { dept: string; items: ShareRecipient[] }[] = [];
    const idx = new Map<string, number>();
    for (const r of list) {
      const dept = r.department?.trim() || "未分组";
      let i = idx.get(dept);
      if (i === undefined) {
        i = groups.length;
        idx.set(dept, i);
        groups.push({ dept, items: [] });
      }
      groups[i].items.push(r);
    }
    return { total: list.length, groups };
  }, [shareRecipients, shareSearch]);

  // 参考来源点击：外链新标签打开；内部路由（/开头）应用内跳转并关闭聊天窗，让目标页定位高亮
  const handleOpenSource = useCallback(
    (c: RagCitation) => {
      const url = c.url;
      if (!url) return;
      if (/^https?:\/\//i.test(url) || c.sourceType === "web") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      setOpen(false);
      navigate(url);
    },
    [navigate],
  );

  // 打开分享面板并拉取收件人列表（仅需登录，失败提示但不阻断）
  const openShare = useCallback((message: ApiMessage) => {
    setShareTarget(message);
    setShareSearch("");
    setShareConfirm(null);
    setShareLoading(true);
    authFetch("/api/chat/share-recipients")
      .then((res) => (res.ok ? res.json() : []))
      .then((list: ShareRecipient[]) => setShareRecipients(Array.isArray(list) ? list : []))
      .catch(() => setShareRecipients([]))
      .finally(() => setShareLoading(false));
  }, []);

  // 允许任意组件通过全局事件唤起 MateChat（如连续打卡卡片的 CTA）
  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener(MATECHAT_OPEN_EVENT, openChat);
    return () => window.removeEventListener(MATECHAT_OPEN_EVENT, openChat);
  }, []);

  // 数据
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);

  // 把回答作为站内消息发给某位同事（复用研发站内消息通道）。
  // 定义在 activeId 之后：依赖数组引用 activeId，放在其声明前会触发 TDZ。
  const shareToColleague = useCallback(
    async (recipient: ShareRecipient) => {
      if (!shareTarget) return;
      setShareSendingId(recipient.id);
      try {
        await sendRdMessage({
          recipient_id: recipient.id,
          subject: "来自 MateChat 的回答分享",
          body: shareTarget.content,
        });
        void apiRecordUsageEvent({
          eventType: "share",
          conversationId: activeId ?? undefined,
          messageId: shareTarget.id,
          model: shareTarget.model ?? undefined,
          metadata: { method: "colleague" },
        }).catch(() => undefined);
        toast.success(`已分享给 ${recipient.name}`);
        setShareTarget(null);
      } catch {
        toast.error("分享失败，请稍后重试");
      } finally {
        setShareSendingId(null);
      }
    },
    [shareTarget, activeId],
  );
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // UI 状态
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  // 「停止生成」：中止 SSE 请求。连接一断后端就停 ReAct 循环（不再发起新一轮上游调用、
  // 不再执行新的工具批次），已生成的部分正文由后端照常落库。
  useI18n(); // 订阅语言切换，切到英文后下方 t() 的文案立即重渲染
  const abortRef = useRef<AbortController | null>(null);
  // 每次发送自增。停止后的对账是后台轮询，可能拖到几十秒后才返回——期间用户若已发出新问题
  // 或切走会话，这份旧快照就不能再往界面上铺，否则会把新的乐观消息冲掉。
  const sendSeqRef = useRef(0);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<FeedbackDraft>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  // key = message id, value = 引用数据（命中知识库时由后端 SSE 推送）
  const [msgCitations, setMsgCitations] = useState<Record<string, MessageCitations>>({});
  // key = message id, value = ReAct 工具调用步骤（模型查任务/知识库/人员时由后端 SSE 推送）
  const [msgToolSteps, setMsgToolSteps] = useState<Record<string, ToolStep[]>>({});
  // key = message id, value = 写操作待确认动作卡（确认/取消后原位更新状态）
  const [msgPendingActions, setMsgPendingActions] = useState<Record<string, PendingActionView[]>>({});
  // 已展开的工具步骤，key = `${messageId}:${callId}`（按消息隔离，避免不同回答的同名步骤互相影响）
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  // key = message id，值为首字之前的阶段提示。上游 TTFT 可达数十秒，这段时间要让用户知道系统在干什么
  const [msgStatus, setMsgStatus] = useState<Record<string, string>>({});
  // 个性化快捷建议：按当前账号逾期/待审核/权限由后端拼装；拉取失败回退静态 QUICK_PROMPTS
  const [dynamicPrompts, setDynamicPrompts] = useState<string[] | null>(null);
  // RAG 探活状态（embedding 配置 + 索引文档数）
  const [rag, setRag] = useState<RagStatus | null>(null);
  // KB→RAG 一键回填进行中（仅 KB 管理员触发）
  const [backfilling, setBackfilling] = useState(false);

  // 附件上传
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 同步镜像，供 addFiles 同步计算剩余名额（避免闭包拿到旧 state）
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  // 拖拽进出计数，避免子元素 enter/leave 抖动
  const dragDepthRef = useRef(0);
  // 记录创建过的本地 blob URL，组件卸载时统一回收
  const createdBlobUrlsRef = useRef<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!feedbackDraft) return;
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feedbackDraft]);

  // ── 气泡位置初始化 + resize 归位 ───────────────────────────────────────────

  useEffect(() => {
    setBubblePos(getDefaultFloatingPosition(bubbleRef.current));
    setBubbleReady(true);
  }, []);

  useEffect(() => {
    if (!bubbleReady) return;
    const el = bubbleRef.current;
    if (!el) return;
    // 水平定位完全由这里管理（button 的 style 属性不写 left/right），
    // 否则 React 重渲染会把 left 写回，与 right 同时生效将把 fixed 元素拉宽。
    const w = el.offsetWidth;
    const toRight = bubblePos.x + w / 2 > window.innerWidth / 2;
    el.style.top = `${bubblePos.y}px`;
    if (toRight) {
      el.style.left = "auto";
      el.style.right = `${Math.max(FLOATING_MARGIN, window.innerWidth - bubblePos.x - w)}px`;
    } else {
      el.style.right = "auto";
      el.style.left = `${bubblePos.x}px`;
    }
    setAnchorRight(toRight);
  }, [bubblePos, bubbleReady]);

  useEffect(() => {
    if (!bubbleReady) return;
    let rafId = 0;
    const resetToDefault = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        setBubblePos(getDefaultFloatingPosition(bubbleRef.current));
      });
    };
    window.addEventListener("resize", resetToDefault);
    window.visualViewport?.addEventListener("resize", resetToDefault);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resetToDefault);
      window.visualViewport?.removeEventListener("resize", resetToDefault);
    };
  }, [bubbleReady]);

  // ── 对话框动画 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setRendered(true);
      const t = window.setTimeout(() => setVisible(true), 16);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
    if (!rendered) return;
    const t = window.setTimeout(() => setRendered(false), 260);
    return () => window.clearTimeout(t);
  }, [open, rendered]);

  // ── 首次打开加载数据（含 5 分钟缓存，避免反复开关抽屉时重复拉取） ────────────
  const lastLoadedAt = useRef<number>(0);
  const CACHE_TTL_MS = 5 * 60 * 1000;
  // 初始化加载在途标记：防止 StrictMode 双触发 / 快速开关抽屉时并发执行 loadInit，
  // 否则新用户的「自动建默认对话」可能被并发触发出多个空对话。
  const initInFlightRef = useRef(false);

  const loadInit = useCallback(async (forceRefresh = false) => {
    if (initInFlightRef.current) return;
    const now = Date.now();
    // 缓存未过期且非强刷 → 跳过
    if (!forceRefresh && conversations.length > 0 && models.length > 0 && now - lastLoadedAt.current < CACHE_TTL_MS) {
      return;
    }
    initInFlightRef.current = true;
    setLoadingConvs(true);
    try {
      const [convs, mds] = await Promise.all([apiListConversations(), apiListModels()]);
      setModels(mds);
      if (mds.length > 0 && !selectedModel) setSelectedModel(mds[0].id);
      if (convs.length > 0) {
        setConversations(convs);
        if (!activeId) setActiveId(convs[0].id);
      } else {
        // 新用户首次使用：没有任何历史对话 → 自动建一个默认对话并选中，省去手动点「新建」，
        // 让聊天窗口开箱即用。建过一次后会话已持久化，后续打开不会再进此分支、不会堆叠空对话。
        try {
          const conv = await apiCreateConversation();
          setConversations([conv]);
          setActiveId(conv.id);
        } catch {
          // 自动建默认对话失败不阻断（用户仍可手动点「新建」）
          setConversations([]);
        }
      }
      lastLoadedAt.current = now;
      // 探活 RAG（embedding 是否配置 + 索引文档数）— 失败不影响主流程
      ragStatus().then(setRag).catch(() => setRag(null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoadingConvs(false);
      initInFlightRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) void loadInit(); }, [open, loadInit]);

  useEffect(() => {
    if (open) void apiRecordUsageEvent({ eventType: "chat_open" }).catch(() => undefined);
  }, [open]);

  // ── KB→RAG 一键回填：embedding 已配置但索引为空时，KB 管理员可一键把知识库灌入向量索引 ──
  const handleBackfillRag = useCallback(async () => {
    if (backfilling) return;
    setBackfilling(true);
    try {
      const res = await backfillKbToRag();
      toast.success(
        res.failed > 0
          ? `回填完成：成功 ${res.succeeded}/${res.total} 条，失败 ${res.failed} 条`
          : `回填完成：已索引 ${res.succeeded}/${res.total} 条知识库条目`,
      );
      // 重新探活刷新徽章（成功后 chunkCount 应 > 0，徽章转为「RAG 就绪」）
      const next = await ragStatus().catch(() => null);
      if (next) setRag(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "回填失败，请稍后重试");
    } finally {
      setBackfilling(false);
    }
  }, [backfilling]);

  // ── 个性化快捷建议：每次打开都按最新任务/待办重算，避免长驻页面一直显示旧内容 ──
  useEffect(() => {
    if (!user?.id || !open) return;
    let cancelled = false;
    setDynamicPrompts(null);
    authFetch("/api/chat/quick-suggestions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: string[] } | null) => {
        if (!cancelled && Array.isArray(data?.suggestions) && data.suggestions.length > 0) {
          setDynamicPrompts(data.suggestions);
        }
      })
      .catch(() => {
        /* 静默回退静态 QUICK_PROMPTS */
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, open]);

  // ── 切换会话时加载消息 ──────────────────────────────────────────────────────

  /**
   * 从服务端拉取会话消息并恢复挂在消息上的确认卡。
   * 切换会话时用，「停止生成」后也用——中断没有 done 事件，得靠重拉把乐观占位换成
   * 后端已落库的半截回答（含真实 id），否则气泡会永远停在「生成中」。
   */
  /**
   * 把一份服务端消息列表铺到界面上，并恢复挂在消息上的工具步骤与确认卡。
   * isStale 在每次写 state 前检查：并发加载 / 中途切换会话时，旧的这份数据不能覆盖新会话——
   * 否则快速切 A→B→A 时先发后至的响应会把 A 的历史铺到 B 上。
   */
  const applyConversation = useCallback(
    async (convId: string, msgs: ApiMessage[], isStale?: () => boolean) => {
      if (isStale?.()) return;
      setMessages(msgs);
      // 恢复工具步骤条：没有它，刷新后分享含任务数据的回答会跳过越权确认（见 TASK_REF_TOOLS）
      const stepsByMsg: Record<string, ToolStep[]> = {};
      for (const m of msgs) {
        if (m.toolSteps && m.toolSteps.length > 0) stepsByMsg[m.id] = m.toolSteps;
      }
      setMsgToolSteps(stepsByMsg);
      // 恢复未决确认卡：挂回其所属消息（无 messageId 的兜底挂到最后一条 assistant 消息）
      const pendings = await apiGetPendingActions(convId);
      if (isStale?.()) return; // 上面这个 await 期间可能已切走会话，别把过期的卡铺上去
      const lastAssistantId = [...msgs].reverse().find((m) => m.role === "assistant")?.id;
      const byMsg: Record<string, PendingActionView[]> = {};
      for (const p of pendings) {
        const mid = p.messageId ?? lastAssistantId;
        if (!mid) continue;
        (byMsg[mid] ??= []).push({ ...p.card, status: "pending" });
      }
      setMsgPendingActions(byMsg);
    },
    [],
  );

  const hydrateConversation = useCallback(
    async (convId: string, isStale?: () => boolean) =>
      applyConversation(convId, await apiGetMessages(convId), isStale),
    [applyConversation],
  );

  /**
   * 「停止生成」后与服务端对账。
   *
   * 中断没有 done 事件，而后端是在循环退出之后才把半截回答落库——本轮若还有工具在跑
   * （生图预算 5 分钟），落库会更晚。此时直接重拉会得到一份还没有这条回答的列表，
   * 把用户刚看到的正文当场抹掉。所以轮询到它出现为止，且**任何情况下都不删本地气泡**：
   * 对不上就让用户继续看着已流式收到的内容，下次切换会话自然被真实数据覆盖。
   */
  const reconcileAfterStop = useCallback(
    async (convId: string, userMessageId: string, seq: number, replacedAssistantId?: string) => {
      // 退避到约 5.5 分钟：中断时若还有生图在跑（预算 5 分钟），后端要等它跑完才落库。
      // 有 seq 守卫兜底，用户一旦发新问题或切走会话，轮询立即停止，不会白转。
      for (const waitMs of [0, 400, 1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000]) {
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
        if (sendSeqRef.current !== seq) return; // 用户已发新问题或切了会话，这份快照作废
        try {
          const msgs = await apiGetMessages(convId);
          if (sendSeqRef.current !== seq) return;
          const userIdx = msgs.findIndex((m) => m.id === userMessageId);
          // 重新回答场景下旧答案要到落库事务里才删掉，必须排除它，否则会误判为「已落库」
          const landed =
            userIdx >= 0 &&
            msgs.slice(userIdx + 1).some((m) => m.role === "assistant" && m.id !== replacedAssistantId);
          if (landed) {
            await applyConversation(convId, msgs);
            return;
          }
        } catch {
          // 网络抖动：下一轮重试，不打断用户
        }
      }
    },
    [applyConversation],
  );

  useEffect(() => {
    if (!activeId) return;
    const convId = activeId;
    // 切换会话：先中止上一会话仍在进行的流。否则它会继续把 delta/done 写向一个已被清空的列表
    // （全部变成空操作——回答虽在后端落库却永远不在界面出现，正是「切走再回来内容没了」的成因），
    // 还白占一条浏览器连接。abort 后后端按「断流」把已生成的内容收尾落库，切回本会话时下面的
    // hydrate 会重新拉到它；sendSeq 自增则让上一条流的停止对账立即作废，不至于把旧会话内容铺到新会话。
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      sendSeqRef.current += 1;
      setSending(false);
    }
    let cancelled = false;
    setLoadingMsgs(true);
    setMessages([]);
    setMsgPendingActions({});
    setExpandedSteps(new Set());
    setMsgStatus({});
    hydrateConversation(convId, () => cancelled)
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : "加载消息失败"); })
      .finally(() => { if (!cancelled) setLoadingMsgs(false); });
    return () => { cancelled = true; };
  }, [activeId, hydrateConversation]);

  // ── 消息自动滚动到底部 ──────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── 过滤会话列表 ────────────────────────────────────────────────────────────

  const filteredConvs = conversations
    .filter((c) => {
      if (!keyword.trim()) return true;
      const q = keyword.toLowerCase();
      return c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  // ── 新建对话 ────────────────────────────────────────────────────────────────

  const createConversation = async () => {
    try {
      const conv = await apiCreateConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setMessages([]);
      setDraft("");
      setIsRenaming(false);
      toast.success("已新建对话");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "新建失败");
    }
  };

  // ── 附件上传（按钮 / 拖拽 / 粘贴 三种入口共用）──────────────────────────────

  // 镜像最新附件，供 addFiles 同步读取
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  // 卸载时回收所有本地 blob URL，避免内存泄漏
  useEffect(() => {
    const urls = createdBlobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const uploadOne = useCallback(async (localId: string, file: File) => {
    try {
      const r = await apiUploadFile(file);
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId
            ? {
                ...a,
                status: "done",
                fileId: r.fileId,
                name: r.fileName || a.name,
                mime: r.mimeType || a.mime,
                size: typeof r.fileSize === "number" ? r.fileSize : a.size,
              }
            : a,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "上传失败";
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, status: "error", error: message } : a)),
      );
      toast.error(`「${file.name}」上传失败：${message}`);
    }
  }, []);

  // 超大图片：先压缩，成功则转上传，压不下去则标错（不直接丢弃）
  const compressThenUpload = useCallback(
    async (localId: string, file: File) => {
      let compressed: File | null = null;
      try {
        compressed = await compressImageToLimit(file, IMAGE_UPLOAD_MAX_BYTES);
      } catch {
        compressed = null;
      }
      if (!compressed) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.localId === localId
              ? { ...a, status: "error", error: "图片无法压缩到 9MB 以内（可能是格式不支持，如 HEIC）" }
              : a,
          ),
        );
        toast.error(`「${file.name}」无法压缩到 9MB 以内，已跳过`);
        return;
      }
      const out = compressed;
      const previewUrl = URL.createObjectURL(out);
      createdBlobUrlsRef.current.add(previewUrl);
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId
            ? { ...a, status: "uploading", name: out.name, size: out.size, mime: out.type, previewUrl }
            : a,
        ),
      );
      toast.success(`「${file.name}」已压缩至 ${fmtFileSize(out.size)}`);
      await uploadOne(localId, out);
    },
    [uploadOne],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const room = ATTACH_MAX_COUNT - attachmentsRef.current.length;
      if (room <= 0) {
        toast.error(`最多上传 ${ATTACH_MAX_COUNT} 个附件`);
        return;
      }
      const items: PendingAttachment[] = [];
      const direct: { localId: string; file: File }[] = [];
      const toCompress: { localId: string; file: File }[] = [];
      let taken = 0;
      for (const file of files) {
        if (taken >= room) {
          toast.error(`最多上传 ${ATTACH_MAX_COUNT} 个附件，多余的已忽略`);
          break;
        }
        const localId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isImg = isImageFile(file);
        // 非图片超 20MB 无法压缩，跳过
        if (!isImg && file.size > ATTACH_MAX_BYTES) {
          toast.error(`「${file.name}」超过 20MB，已跳过`);
          continue;
        }
        // 图片超过后端视觉上限（9MB）：先占位再压缩，避免上传后被后端以「图片过大」拒绝
        if (isImg && file.size > IMAGE_UPLOAD_MAX_BYTES) {
          items.push({
            localId,
            name: file.name || "未命名图片",
            size: file.size,
            mime: file.type || "image/jpeg",
            status: "compressing",
          });
          toCompress.push({ localId, file });
          taken++;
          continue;
        }
        let previewUrl: string | undefined;
        if (isImg) {
          previewUrl = URL.createObjectURL(file);
          createdBlobUrlsRef.current.add(previewUrl);
        }
        items.push({
          localId,
          name: file.name || "未命名文件",
          size: file.size,
          mime: file.type || "application/octet-stream",
          status: "uploading",
          previewUrl,
        });
        direct.push({ localId, file });
        taken++;
      }
      if (items.length === 0) return;
      attachmentsRef.current = [...attachmentsRef.current, ...items];
      setAttachments((prev) => [...prev, ...items]);
      for (const d of direct) void uploadOne(d.localId, d.file);
      for (const c of toCompress) void compressThenUpload(c.localId, c.file);
    },
    [uploadOne, compressThenUpload],
  );

  const removeAttachment = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        createdBlobUrlsRef.current.delete(target.previewUrl);
      }
      const next = prev.filter((a) => a.localId !== localId);
      attachmentsRef.current = next;
      return next;
    });
  }, []);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    addFiles(files);
    e.target.value = ""; // 允许重复选择同一文件
  };

  const onPasteInput = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault(); // 阻止把文件路径当文本粘进输入框
      addFiles(files);
    }
  };

  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  const onDragEnter = (e: React.DragEvent) => {
    if (!activeId || !dragHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!activeId || !dragHasFiles(e)) return;
    e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!activeId) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) addFiles(files);
  };

  // ── 发送消息（智能模式：自动并行检索内部数据库 + 走 LLM 流式回答）─────────────

  const handleSend = useCallback(
    async (preset?: string, options?: { regenerateMessage?: ApiMessage }) => {
      if (!activeId || sending) return;
      const regenerateMessage = options?.regenerateMessage;
      const isRegenerate = Boolean(regenerateMessage);
      const isPreset = preset !== undefined;
      const content = (preset ?? draft).trim();
      // 附件仅随手动发送提交；快捷提问 / 重新回答（preset）只发文本，不动托盘
      const sendableAtts = isPreset
        ? []
        : attachments.filter((a) => a.status === "done" && a.fileId);
      if (!isPreset && attachments.some((a) => a.status === "uploading" || a.status === "compressing")) {
        toast.error("附件还在处理中，请稍候");
        return;
      }
      if (!content && sendableAtts.length === 0) return;

      // 乐观展示用的附件视图（图片用本地 blob 预览）
      const optimisticAtts: AttachmentView[] = sendableAtts.map((a) => ({
        fileId: a.fileId as string,
        name: a.name,
        mime: a.mime,
        size: a.size,
        url: a.previewUrl ?? null,
        isImage: a.mime.startsWith("image/"),
      }));
      // 传给后端的入参：只传 fileId 等，后端回查 FileAsset 作为权威来源
      const attachPayload = sendableAtts.map((a) => ({
        fileId: a.fileId as string,
        name: a.name,
        mime: a.mime,
        size: a.size,
      }));

      setDraft("");
      if (!isPreset) {
        // 清空托盘（blob 仍被乐观消息引用，保留到卸载时统一回收）
        setAttachments([]);
        attachmentsRef.current = [];
      }
      setSending(true);

      const tempUserId = `tmp-user-${Date.now()}`;
      const tempAiId = `tmp-ai-${Date.now()}`;
      // 幂等键：这一次逻辑发送的唯一标识。同一条消息若因任何原因被重发（代理重放等），
      // 后端据此只落一条用户消息、不重复提问。重新回答走 regenerateMessageId，不需要它。
      const clientMessageId =
        !isRegenerate && typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : undefined;
      const now = new Date().toISOString();
      // 在函数作用域声明：finally 块要访问它，不能放进 try 块（块级作用域下 finally 取不到 → ReferenceError）。
      let realUserId = tempUserId;
      // 同理提到函数作用域：中断落在 catch 里，要靠它判断「有没有写出内容」来决定保留还是撤掉气泡。
      let streamedContent = "";
      // 本轮是否已经产出过用户可见的东西（正文之外还包括工具步骤 / 确认卡 / 生成的文件）。
      // 多轮工具场景前几轮往往只有工具步骤而无正文，断流时不能只看 streamedContent 就把它们连同
      // 气泡一起删掉——那些内容后端会按「断流」落库，前端要保留并对账，与后端判据保持一致。
      let hadVisibleArtifact = false;

      // 普通提问追加一问一答；重新回答只在原位置替换 AI 占位，不重复创建用户问题。
      setMessages((prev) => isRegenerate && regenerateMessage
        ? prev.map((message) => message.id === regenerateMessage.id
          ? { id: tempAiId, role: "assistant", content: "", model: selectedModel || null, reaction: null, createdAt: now }
          : message)
        : [
            ...prev,
            { id: tempUserId, role: "user", content, model: null, reaction: null, createdAt: now, attachments: optimisticAtts },
            { id: tempAiId, role: "assistant", content: "", model: selectedModel || null, reaction: null, createdAt: now },
          ]);

      const abortController = new AbortController();
      abortRef.current = abortController;
      sendSeqRef.current += 1;
      const sendSeq = sendSeqRef.current;

      try {
        const res = await authFetch(`/api/chat/conversations/${activeId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: content || undefined,
            model: selectedModel || undefined,
            attachments: attachPayload.length > 0 ? attachPayload : undefined,
            regenerateMessageId: regenerateMessage?.id,
            clientMessageId,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(err.message ?? "发送失败");
        }

        // 提问已成功落库（question_submitted），广播使用事件，让连续打卡卡片等实时刷新
        notifyMateChatActivity();

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let currentFromDb = false;
        let currentFromRag = false;
        let currentFromWeb = false;
        let currentFromAttachment = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as SseEvent;

              if (event.type === "userMessage") {
                realUserId = event.messageId;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempUserId ? { ...m, id: event.messageId } : m)),
                );
              }

              if (event.type === "context") {
                currentFromDb = event.fromDb;
                currentFromRag = Boolean(event.fromRag);
                currentFromWeb = Boolean(event.fromWeb);
                currentFromAttachment = Boolean(event.fromAttachment);
              }

              if (event.type === "citations") {
                // 临时挂到 tempAiId 上；done 事件里替换为 realAiId 时一起搬过去
                setMsgCitations((prev) => ({
                  ...prev,
                  [tempAiId]: { citations: event.citations, filteredByPermission: event.filteredByPermission },
                }));
              }

              if (event.type === "citations_extra") {
                currentFromWeb = true;
                // 回答完成后追加的联网来源：合并进已有引用卡（无则新建）
                setMsgCitations((prev) => {
                  const cur = prev[tempAiId];
                  return {
                    ...prev,
                    [tempAiId]: {
                      citations: [...(cur?.citations ?? []), ...event.citations],
                      filteredByPermission: cur?.filteredByPermission ?? 0,
                    },
                  };
                });
              }

              if (event.type === "modelSwitched") {
                // 后端为图片场景静默路由到多模态模型：不弹提示打扰用户，
                // 只把本轮气泡的模型标签改为实际作答模型，保持如实。
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, model: event.to } : m)),
                );
              }

              if (event.type === "tool_step") {
                hadVisibleArtifact = true;
                // 同 callId 原位更新（running → ok/error），新 callId 追加
                const step: ToolStep = {
                  callId: event.callId,
                  tool: event.tool,
                  label: event.label,
                  status: event.status,
                  detail: event.detail,
                  thought: event.thought,
                  args: event.args,
                  output: event.output,
                };
                setMsgToolSteps((prev) => {
                  const cur = prev[tempAiId] ?? [];
                  const idx = cur.findIndex((s) => s.callId === event.callId);
                  const next = idx >= 0 ? cur.map((s, i) => (i === idx ? step : s)) : [...cur, step];
                  return { ...prev, [tempAiId]: next };
                });
              }

              if (event.type === "status") {
                setMsgStatus((prev) => ({ ...prev, [tempAiId]: event.label }));
              }

              if (event.type === "pending_action") {
                hadVisibleArtifact = true;
                const view: PendingActionView = { ...event.action, status: "pending" };
                setMsgPendingActions((prev) => ({
                  ...prev,
                  [tempAiId]: [...(prev[tempAiId] ?? []), view],
                }));
              }

              if (event.type === "delta") {
                // 正文开始了，阶段提示功成身退
                if (streamedContent === "") {
                  setMsgStatus((prev) => {
                    if (!(tempAiId in prev)) return prev;
                    const { [tempAiId]: _done, ...rest } = prev;
                    return rest;
                  });
                }
                streamedContent += event.delta;
                const captured = streamedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, content: captured } : m)),
                );
              }

              if (event.type === "content_final") {
                // 服务端抑制了 file-export 块的流式输出：用最终正文整体覆盖
                streamedContent = event.content;
                const captured = streamedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, content: captured } : m)),
                );
              }

              if (event.type === "files_generated") {
                hadVisibleArtifact = true;
                const atts = event.attachments;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAiId
                      ? { ...m, attachments: [...(m.attachments ?? []), ...atts] }
                      : m,
                  ),
                );
                toast.success(atts.every((a) => a.isImage) ? "图片已生成" : "文件已生成，点击附件卡片下载");
              }

              if (event.type === "done") {
                const realAiId = event.messageId;
                const sources: NonNullable<ApiMessage["sources"]> = [];
                if (currentFromDb) sources.push("db");
                if (currentFromRag) sources.push("rag");
                if (currentFromWeb) sources.push("web");
                if (currentFromAttachment) sources.push("attachment");
                if (sources.length === 0) sources.push("ai");
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, id: realAiId, sources } : m)),
                );
                setMsgCitations((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: pulled, ...rest } = prev;
                  return { ...rest, [realAiId]: pulled };
                });
                setMsgToolSteps((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: pulled, ...rest } = prev;
                  return { ...rest, [realAiId]: pulled };
                });
                setMsgPendingActions((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: pulled, ...rest } = prev;
                  return { ...rest, [realAiId]: pulled };
                });
                // 展开态按 `${messageId}:${callId}` 存，消息换 id 后要跟着搬，不然面板会自己收起
                setMsgStatus((prev) => {
                  if (!(tempAiId in prev)) return prev;
                  const { [tempAiId]: _dropped, ...rest } = prev;
                  return rest; // 回答已出，阶段提示不再需要，顺手清掉临时键
                });
                setExpandedSteps((prev) => {
                  const next = new Set<string>();
                  for (const key of prev) {
                    next.add(key.startsWith(`${tempAiId}:`) ? `${realAiId}:${key.slice(tempAiId.length + 1)}` : key);
                  }
                  return next;
                });
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === activeId
                      ? {
                          ...c,
                          title: event.title ?? c.title,
                          summary: streamedContent.slice(0, 60),
                          updatedAt: new Date().toISOString(),
                        }
                      : c,
                  ),
                );
              }

              if (event.type === "error") {
                toast.error(event.message);
                setMessages((prev) => isRegenerate && regenerateMessage
                  ? prev.map((message) => message.id === tempAiId ? regenerateMessage : message)
                  : prev.filter((m) => m.id !== tempAiId && (realUserId !== tempUserId || m.id !== tempUserId)));
                // 气泡已移除，清掉挂在临时 id 上的工具步骤/确认卡，避免残留孤儿数据
                setMsgToolSteps((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: _removed, ...rest } = prev;
                  return rest;
                });
                setMsgPendingActions((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: _removed, ...rest } = prev;
                  return rest;
                });
              }
            } catch {
              // ignore JSON parse errors
            }
          }
        }
      } catch (err) {
        // 已产出的判据：正文，或工具步骤/确认卡/生成文件——任一非空都说明用户已看到东西，
        // 后端会按「断流」把它们落库，前端就要保留并对账，不能整体作废（多轮工具场景正文常为空）。
        const hasVisibleOutput = streamedContent.trim().length > 0 || hadVisibleArtifact;
        // 用户主动停止：不是错误，不弹 toast。
        if (err instanceof DOMException && err.name === "AbortError") {
          if (hasVisibleOutput) {
            // 已经产出了一部分：后端会把它落库，但那发生在中断之后（本轮若还有工具在跑会更晚），
            // 故轮询对账而不是立刻重拉，期间保留用户已看到的内容。
            void reconcileAfterStop(activeId, realUserId, sendSeq, regenerateMessage?.id);
          } else {
            // 一个字都没写出来就停：后端同样不会落一条空回答，占位气泡必须就地撤掉，
            // 否则它会永远停在「生成中」，等一条永远不会出现的消息。
            setMessages((prev) => isRegenerate && regenerateMessage
              ? prev.map((message) => (message.id === tempAiId ? regenerateMessage : message))
              : prev.filter((m) => m.id !== tempAiId));
          }
        } else if (hasVisibleOutput) {
          // 连接中断但已有产出：绝不当场抹掉用户看到的内容。后端在断开时会把半截回答落库
          //（收尾发生在断开之后），复用停止生成的轮询对账等它出现；万一没落库，对账也不会删本地气泡。
          toast.error("网络连接中断，已保留当前生成的内容");
          void reconcileAfterStop(activeId, realUserId, sendSeq, regenerateMessage?.id);
        } else {
          // 一无所有的失败：给可读的中文提示，不把浏览器原生的 "Failed to fetch" 直接抛给用户。
          // 提问已在后端落库（收到过 userMessage 事件即 realUserId 变化），故用户气泡保留、只撤 AI 占位，
          // 用户无需、也不应手动重发（会产生重复提问）——文案据此区分。
          const questionPersisted = realUserId !== tempUserId;
          const message =
            err instanceof TypeError
              ? questionPersisted
                ? "网络中断，回答生成失败。问题已保存，可点回答下方的重新生成，不必重复提问。"
                : "网络连接失败，请检查网络后重试。"
              : err instanceof Error
                ? err.message
                : "发送失败";
          toast.error(message);
          setMessages((prev) => isRegenerate && regenerateMessage
            ? prev.map((message) => message.id === tempAiId ? regenerateMessage : message)
            : prev.filter((m) => m.id !== tempAiId && (realUserId !== tempUserId || m.id !== tempUserId)));
        }
      } finally {
        // 所有退出路径（完成/出错/中断）统一清掉阶段提示，避免临时键残留
        setMsgStatus((prev) => {
          if (!(tempAiId in prev)) return prev;
          const { [tempAiId]: _dropped, ...rest } = prev;
          return rest;
        });
        // 只有当仍是本次发送在占用锁时才复位：切换会话会主动 abort 上一条流并立刻把
        // sending/abortRef 让给新会话，此时旧流的这段收尾若无条件清空，就会把新会话的停止
        // 控制器和发送锁一起误清（新会话停止按钮失效、状态错乱）。按 controller 身份守卫。
        if (abortRef.current === abortController) {
          abortRef.current = null;
          setSending(false);
        }
        void (realUserId); // suppress unused warning
      }
    },
    [activeId, sending, draft, selectedModel, attachments, reconcileAfterStop],
  );

  /** 展开/收起某个工具步骤的调用参数与返回结果 */
  const toggleStep = useCallback((stepKey: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (!next.delete(stepKey)) next.add(stepKey);
      return next;
    });
  }, []);

  /** 停止生成：中止 SSE 请求，后端据此停掉 ReAct 循环（不再发起新一轮上游调用与工具批次） */
  const handleStop = useCallback(() => {
    // 只触发中止；abortRef 的清理与 sending 复位统一交给流收尾的 finally（它按 controller 身份守卫）。
    // ⚠️ 不要在这里把 abortRef 置 null：那样 finally 的 `abortRef.current === abortController` 守卫
    // 就永远不匹配，setSending(false) 不执行 → 点停止后卡在「生成中」、切会话也复位不了，只能刷新。
    // abort 后 catch 的 AbortError 分支会保留已生成内容并对账（或撤掉空占位气泡），无需在此另做处理。
    abortRef.current?.abort();
  }, []);

  // ── ReAct 写操作确认卡：确认执行 / 取消 ──────────────────────────────────────

  const handlePendingAction = async (msgId: string, actionId: string, decision: "confirm" | "cancel") => {
    const patch = (status: PendingActionView["status"], resultMessage?: string) =>
      setMsgPendingActions((prev) => ({
        ...prev,
        [msgId]: (prev[msgId] ?? []).map((a) => (a.id === actionId ? { ...a, status, resultMessage } : a)),
      }));
    patch("submitting");
    try {
      const res = await authFetch(`/api/chat/actions/${actionId}/${decision}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? "操作失败");
      patch(decision === "confirm" ? "executed" : "canceled", data.message);
      if (decision === "confirm") toast.success(data.message ?? "已执行");
    } catch (err) {
      const message = err instanceof Error ? err.message : "操作失败";
      patch("failed", message);
      toast.error(message);
    }
  };

  // ── 重新生成 ────────────────────────────────────────────────────────────────

  const handleRefresh = async (msgId: string) => {
    if (!activeId || sending) return;
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx <= 0) return;
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!prevUser) { toast.error("找不到上一条问题"); return; }
    await handleSend(prevUser.content, { regenerateMessage: messages[idx] });
  };

  // ── 置顶 / 重命名 / 删除 ────────────────────────────────────────────────────

  const togglePin = async () => {
    if (!activeConv) return;
    const updated = await apiUpdateConversation(activeConv.id, { pinned: !activeConv.pinned });
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, pinned: updated.pinned } : c)));
  };

  const confirmRename = async () => {
    if (!activeConv) return;
    const title = renameTitle.trim();
    if (!title) return;
    const updated = await apiUpdateConversation(activeConv.id, { title });
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)));
    setIsRenaming(false);
    toast.success("标题已更新");
  };

  const removeConversation = () => {
    if (!activeConv) return;
    setDeleteConfirm({ kind: "conversation", id: activeConv.id, label: activeConv.title });
  };

  const doDeleteConversation = async (id: string) => {
    try {
      await apiDeleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      setActiveId(remaining[0]?.id ?? null);
      setMessages([]);
      setIsRenaming(false);
      setDeleteConfirm(null);
      toast.success("对话已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  // ── 消息操作 ────────────────────────────────────────────────────────────────

  const handleReaction = async (msgId: string, reaction: "like" | "dislike") => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    if (reaction === "dislike" && msg.reaction !== "dislike") {
      setFeedbackDraft({
        messageId: msgId,
        reasons: msg.feedback?.reasons ?? [],
        comment: msg.feedback?.comment ?? "",
      });
      return;
    }
    const next = msg.reaction === reaction ? null : reaction;
    setFeedbackDraft(null);
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reaction: next, feedback: null } : m)));
    await apiUpdateReaction(msgId, { reaction: next }).catch(() => {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reaction: msg.reaction, feedback: msg.feedback } : m)));
      toast.error("反馈提交失败，请稍后重试");
    });
  };

  const submitDislikeFeedback = async () => {
    if (!feedbackDraft || submittingFeedback) return;
    if (feedbackDraft.reasons.length === 0) {
      toast.error("请选择至少一个原因");
      return;
    }
    const previous = messages.find((message) => message.id === feedbackDraft.messageId);
    setSubmittingFeedback(true);
    try {
      await apiUpdateReaction(feedbackDraft.messageId, {
        reaction: "dislike",
        reasons: feedbackDraft.reasons,
        comment: feedbackDraft.comment,
      });
      setMessages((current) => current.map((message) =>
        message.id === feedbackDraft.messageId
          ? {
              ...message,
              reaction: "dislike",
              feedback: {
                reaction: "dislike",
                reasons: feedbackDraft.reasons,
                comment: feedbackDraft.comment.trim(),
                status: "open",
              },
            }
          : message,
      ));
      setFeedbackDraft(null);
      toast.success("感谢反馈，我们会纳入问题分析");
    } catch {
      if (previous) {
        setMessages((current) => current.map((message) => message.id === previous.id ? previous : message));
      }
      toast.error("反馈提交失败，请稍后重试");
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const handleDeleteMsg = (msgId: string) => {
    if (messages.length <= 1) { toast.error("至少保留一条消息"); return; }
    setDeleteConfirm({ kind: "message", id: msgId });
  };

  const doDeleteMessage = async (id: string) => {
    try {
      await apiDeleteMessage(id);
      setMessages((prev) => prev.filter((m) => m.id !== id));
      setDeleteConfirm(null);
      toast.success("消息已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.kind === "conversation") void doDeleteConversation(deleteConfirm.id);
    else void doDeleteMessage(deleteConfirm.id);
  };

  const copyText = async (text: string, message: ApiMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      void apiRecordUsageEvent({
        eventType: "copy",
        conversationId: activeId ?? undefined,
        messageId: message.id,
        model: message.model ?? undefined,
        metadata: { method: "clipboard" },
      }).catch(() => undefined);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择内容");
    }
  };

  const currentModel = models.find((m) => m.id === selectedModel);

  // 附件相关派生状态
  const hasPendingAttachment = attachments.some(
    (a) => a.status === "uploading" || a.status === "compressing",
  );
  const readyAttachmentCount = attachments.filter((a) => a.status === "done").length;
  const canSend =
    !!activeId &&
    !sending &&
    !hasPendingAttachment &&
    (draft.trim().length > 0 || readyAttachmentCount > 0);
  const latestAssistantId = [...messages].reverse().find((message) => message.role === "assistant")?.id;

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* 浮动气泡 */}
      <button
        ref={bubbleRef}
        type="button"
        title="打开 MateChat"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const el = bubbleRef.current;
          if (!el) return;
          draggingRef.current = true;
          movedRef.current = false;
          const rect = el.getBoundingClientRect();
          dragStartRef.current = { x: rect.left, y: rect.top, px: e.clientX, py: e.clientY };
          el.setPointerCapture(e.pointerId);
          el.style.cursor = "grabbing";
          el.style.transition = "none";
          document.body.style.userSelect = "none";
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          const el = bubbleRef.current;
          if (!el) return;
          const dx = e.clientX - dragStartRef.current.px;
          const dy = e.clientY - dragStartRef.current.py;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const x = Math.min(Math.max(FLOATING_MARGIN, dragStartRef.current.x + dx), window.innerWidth - w - FLOATING_MARGIN);
          const y = Math.min(Math.max(FLOATING_MARGIN, dragStartRef.current.y + dy), window.innerHeight - h - FLOATING_MARGIN);
          // 直接操作 DOM，零 React 渲染；拖拽期间临时切回左锚，松手后由 effect 重新决定锚定方向
          el.style.right = "auto";
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          const el = bubbleRef.current;
          if (!el) return;
          el.releasePointerCapture(e.pointerId);
          el.style.cursor = "";
          el.style.transition = "";
          document.body.style.userSelect = "";
          // 拖动结束：同步 DOM 实际位置，仅保留在当前页面会话内。
          const x = parseFloat(el.style.left) || bubblePos.x;
          const y = parseFloat(el.style.top) || bubblePos.y;
          setBubblePos({ x, y });
        }}
        onClick={() => { if (!movedRef.current) setOpen(true); movedRef.current = false; }}
        className={cn(
          // 默认收成圆形（只露头像）；hover 时文字平滑展开，减少占位。
          // 定位（left/right/top）由 effect 写 inline style，靠右时右缘锚定向左展开。
          "group fixed z-50 flex items-center rounded-full border border-white/70 bg-indigo-600 p-2 text-white shadow-[0_18px_38px_rgba(79,70,229,0.28)] transition-all duration-200 cursor-grab hover:-translate-y-1 will-change-[left,top]",
          anchorRight && "flex-row-reverse",
          bubbleReady ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/14">
          <img src={AI_AVATAR} alt="MateChat" className="h-7 w-7 object-contain" />
          <span className="absolute inset-[-5px] rounded-full border border-indigo-300/30 animate-pulse" />
        </span>
        {/* 文字：收起态宽度为 0 隐藏，hover 展开；展开方向跟随锚定侧 */}
        <span
          className={cn(
            "flex max-w-0 flex-col overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[180px] group-hover:opacity-100",
            anchorRight ? "group-hover:mr-2 group-hover:pl-2" : "group-hover:ml-2 group-hover:pr-2",
          )}
        >
          <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-white/72">AI Assistant</span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            <Sparkles className="h-4 w-4" />
            MateChat
          </span>
        </span>
      </button>

      {/* 对话框 */}
      {rendered && (
        <div
          className={cn(
            "fixed inset-0 z-[80] transition-all duration-300 ease-out",
            visible ? "bg-slate-950/24 backdrop-blur-[2px]" : "bg-slate-950/0 backdrop-blur-[0px]",
          )}
          onClick={() => setOpen(false)}
        >
          <div
            className={cn(
              "absolute inset-3 flex h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[4px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.95))] shadow-[0_30px_80px_rgba(15,23,42,0.26)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:inset-y-4 md:left-auto md:right-4 md:h-[calc(100vh-32px)] md:w-[min(1120px,calc(100vw-32px))] md:max-w-[calc(100vw-32px)] md:flex-row md:rounded-[32px]",
              visible ? "translate-x-0 scale-100 opacity-100" : "translate-x-8 scale-[0.98] opacity-0",
            )}
            style={{borderRadius: '4px'}}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="MateChat"
          >
            {/* 左侧会话列表 */}
            <section className="flex max-h-[38vh] min-w-0 flex-col border-b border-slate-200/70 bg-slate-50/60 md:max-h-none md:w-[30%] md:min-w-[240px] md:border-b-0 md:border-r">
              <div className="border-b border-slate-200/70 px-5 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">MateChat</div>
                    <h3 className="mt-1 text-slate-900">对话历史</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createConversation()}
                    className="material-button-primary px-3 py-2 text-xs"
                  >
                    <MessageSquarePlus className="h-4 w-4" />
                    新建
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索聊天内容"
                    className="material-input pl-11"
                  />
                </div>
              </div>

              <div className="material-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {loadingConvs ? (
                  <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
                ) : filteredConvs.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center text-sm text-slate-500">
                    {keyword ? "没找到匹配的会话" : "还没有对话，点击「新建」开始吧"}
                  </div>
                ) : (
                  filteredConvs.map((conv) => {
                    const isActive = conv.id === activeId;
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => { setActiveId(conv.id); setIsRenaming(false); }}
                        className={cn(
                          "w-full rounded-[24px] border p-4 text-left transition",
                          isActive
                            ? "border-indigo-100 bg-indigo-50 shadow-[0_8px_18px_rgba(79,70,229,0.12)]"
                            : "border-slate-200/80 bg-white/82 hover:border-slate-300 hover:bg-white",
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-semibold text-slate-900">{conv.title}</div>
                          {conv.pinned && <Pin className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600" />}
                        </div>
                        {conv.summary && (
                          <div className="line-clamp-2 text-xs leading-5 text-slate-500">{conv.summary}</div>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                          <Clock3 className="h-3 w-3" />
                          {fmtDateTime(conv.updatedAt)}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* 右侧消息区 */}
            <section
              className="relative flex min-w-0 flex-1 flex-col"
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              {/* 拖拽上传遮罩 */}
              {dragActive && (
                <div className="pointer-events-none absolute inset-0 z-30 m-3 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-indigo-300 bg-indigo-50/85 backdrop-blur-sm">
                  <Paperclip className="h-8 w-8 text-indigo-500" />
                  <div className="text-sm font-medium text-indigo-700">松开鼠标上传文件</div>
                  <div className="text-xs text-indigo-400">
                    支持图片与文档，最多 {ATTACH_MAX_COUNT} 个 · 单个 ≤ 20MB
                  </div>
                </div>
              )}
              {/* 顶部工具栏 */}
              <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-5">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Conversation</div>
                  <h2 className="mt-1 truncate text-[1.35rem] text-slate-900">
                    {activeConv?.title ?? "MateChat"}
                  </h2>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  {activeConv && (
                    <>
                      <button
                        type="button"
                        onClick={() => void togglePin()}
                        className="material-button-secondary shrink-0 whitespace-nowrap px-3 py-2 text-xs"
                      >
                        <Pin className="h-4 w-4 shrink-0" />
                        {activeConv.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenameTitle(activeConv.title); setIsRenaming(true); }}
                        className="material-button-secondary shrink-0 whitespace-nowrap px-3 py-2 text-xs"
                      >
                        <PencilLine className="h-4 w-4 shrink-0" />
                        重命名
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeConversation()}
                        className="material-button-secondary shrink-0 whitespace-nowrap px-3 py-2 text-xs text-red-500"
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />
                        删除
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-500 transition hover:text-slate-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 重命名栏 */}
              {isRenaming && (
                <div className="border-b border-slate-200/70 bg-slate-50/70 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <input
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void confirmRename(); if (e.key === "Escape") setIsRenaming(false); }}
                      className="material-input flex-1"
                      placeholder="输入新的会话标题"
                      autoFocus
                    />
                    <button type="button" onClick={() => void confirmRename()} className="material-button-primary">保存</button>
                    <button type="button" onClick={() => setIsRenaming(false)} className="material-button-secondary">取消</button>
                  </div>
                </div>
              )}

              {/* 删除确认横幅 */}
              {deleteConfirm && (
                <div className="border-b border-red-100 bg-red-50 px-6 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 text-sm text-red-700">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      {deleteConfirm.kind === "conversation"
                        ? `确认删除对话「${(deleteConfirm as { label: string }).label}」及其全部消息？此操作不可撤销。`
                        : "确认删除这条消息？此操作不可撤销。"}
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={confirmDelete}
                        className="rounded-xl bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        className="material-button-secondary !px-4 !py-1.5 text-xs"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 消息列表 */}
              <div className="material-scrollbar flex-1 overflow-y-auto bg-slate-50/60 px-6 py-6">
                {!activeId ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    选择或新建一个对话开始聊天
                  </div>
                ) : loadingMsgs ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">加载中…</div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    发送第一条消息开始对话
                  </div>
                ) : (
                  <div className="space-y-5">
                    {messages.map((msg) => {
                      const isUser = msg.role === "user";
                      const isStreaming = msg.id.startsWith("tmp-ai-");
                      return (
                        <div key={msg.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                          <div className={cn("flex max-w-[82%] gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
                            {/* 头像 */}
                            {isUser ? (
                              <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f59e90_0%,#f6c56b_58%,#a3c94c_100%)] text-sm font-semibold text-white shadow-sm">
                                {user?.name?.slice(0, 1) ?? "U"}
                              </div>
                            ) : (
                              <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center">
                                <img src={AI_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />
                              </div>
                            )}
                            {/* 消息体 */}
                            <div className={isUser ? "text-right" : ""}>
                              {/* ReAct 工具步骤：模型查任务/知识库/人员的过程可视化 */}
                              {!isUser && (msgToolSteps[msg.id]?.length ?? 0) > 0 && (
                                <div className="mb-1.5 flex flex-col items-start gap-1">
                                  {msgToolSteps[msg.id].map((step) => {
                                    // 执行中还没有观察值，展开无意义；只有拿到 args/output 才可点开
                                    const expandable = Boolean(step.args || step.output);
                                    const stepKey = `${msg.id}:${step.callId}`;
                                    const expanded = expandedSteps.has(stepKey);
                                    const StepIcon =
                                      step.status === "running" ? (
                                        <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                                      ) : step.status === "ok" ? (
                                        <Check className="h-3 w-3 text-emerald-500" />
                                      ) : (
                                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      );
                                    return (
                                      <div key={step.callId} className="flex max-w-full flex-col items-start gap-1">
                                        {/* ReAct 的 Thought：模型为什么要这一步。和结论分开显示，不混进回答正文 */}
                                        {step.thought && (
                                          <div className="flex max-w-full items-start gap-1.5 pl-0.5 text-xs italic text-slate-400">
                                            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                                            <span className="min-w-0">{step.thought}</span>
                                          </div>
                                        )}
                                        <button
                                          type="button"
                                          disabled={!expandable}
                                          onClick={() => toggleStep(stepKey)}
                                          aria-expanded={expandable ? expanded : undefined}
                                          className={cn(
                                            "inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-left text-xs text-slate-600",
                                            expandable && "transition hover:border-indigo-200 hover:text-indigo-600",
                                            !expandable && "cursor-default",
                                          )}
                                        >
                                          {StepIcon}
                                          {/* 步骤名是后端下发的中文常量（工具注册表的 label），英文态要走字典 */}
                                          <span className="shrink-0">{t(step.label)}</span>
                                          {step.detail && (
                                            <span className="truncate text-slate-400">· {step.detail}</span>
                                          )}
                                          {expandable && (
                                            <ChevronDown
                                              className={cn(
                                                "h-3 w-3 shrink-0 text-slate-400 transition-transform",
                                                expanded && "rotate-180",
                                              )}
                                            />
                                          )}
                                        </button>
                                        {expanded && (
                                          <div className="w-full max-w-full space-y-2 rounded-xl border border-slate-200 bg-white/70 p-2.5 text-xs">
                                            {step.args && (
                                              <div>
                                                <div className="mb-1 font-medium text-slate-500">{t("调用参数")}</div>
                                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-600">
                                                  {step.args}
                                                </pre>
                                              </div>
                                            )}
                                            {step.output && (
                                              <div>
                                                <div className="mb-1 font-medium text-slate-500">{t("返回结果")}</div>
                                                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 leading-5 text-slate-600">
                                                  {step.output}
                                                </pre>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {(msg.content || isStreaming) && (
                                <div
                                  className={cn(
                                    "rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm",
                                    // 用户气泡 inline-block + text-left：收缩到文字宽度，避免被同条更宽的图片附件撑宽后
                                    // 文字被 text-right 推到右侧、左侧留白
                                    isUser
                                      ? "inline-block text-left rounded-tr-md bg-indigo-50 text-slate-800"
                                      : "rounded-tl-md bg-[#f5f5fb] text-slate-800",
                                    isStreaming && !msg.content && "py-4",
                                  )}
                                  // 用户消息保留换行原样；AI 回答由 markdown 渲染管理段落
                                  style={isUser ? { whiteSpace: "pre-wrap", wordBreak: "break-word" } : { wordBreak: "break-word" }}
                                >
                                  {isStreaming && !msg.content ? (
                                    <span className="flex items-center gap-2">
                                      <span className="flex items-center gap-1.5">
                                        {[0, 1, 2].map((i) => (
                                          <span
                                            key={i}
                                            className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                                            style={{ animationDelay: `${i * 160}ms`, animationDuration: "0.72s" }}
                                          />
                                        ))}
                                      </span>
                                      {/* 阶段提示：上游首字可能要几十秒，别让用户对着三个点猜系统在干嘛 */}
                                      {msgStatus[msg.id] && (
                                        <span className="text-xs text-slate-400">{t(msgStatus[msg.id])}</span>
                                      )}
                                    </span>
                                  ) : isUser ? (
                                    msg.content
                                  ) : (
                                    <>
                                      <MarkdownContent content={msg.content} />
                                      {isStreaming && (
                                        <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle" />
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                              {/* ReAct 写操作确认卡：AI 生成的待确认动作，用户核对后确认/取消 */}
                              {!isUser && (msgPendingActions[msg.id]?.length ?? 0) > 0 && (
                                <div className="mt-2 flex max-w-[560px] flex-col gap-2">
                                  {msgPendingActions[msg.id].map((action) => (
                                    <div
                                      key={action.id}
                                      className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 text-left shadow-sm"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-indigo-500" />
                                        <span className="text-sm font-bold text-slate-800">{action.label}</span>
                                        {action.status === "pending" && (
                                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">待确认</span>
                                        )}
                                        {action.status === "executed" && (
                                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">已执行</span>
                                        )}
                                        {action.status === "canceled" && (
                                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">已取消</span>
                                        )}
                                        {action.status === "failed" && (
                                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">执行失败</span>
                                        )}
                                      </div>
                                      <dl className="mt-2 space-y-1">
                                        {action.fields.map((f) => (
                                          <div key={f.label} className="flex gap-2 text-xs leading-5">
                                            <dt className="w-16 shrink-0 text-slate-500">{f.label}</dt>
                                            <dd className="min-w-0 break-words text-slate-700">{f.value}</dd>
                                          </div>
                                        ))}
                                      </dl>
                                      {(action.status === "pending" || action.status === "submitting") && (
                                        <div className="mt-3 flex items-center gap-2">
                                          <button
                                            type="button"
                                            disabled={action.status === "submitting"}
                                            onClick={() => void handlePendingAction(msg.id, action.id, "confirm")}
                                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                                          >
                                            {action.status === "submitting" && <Loader2 className="h-3 w-3 animate-spin" />}
                                            确认执行
                                          </button>
                                          <button
                                            type="button"
                                            disabled={action.status === "submitting"}
                                            onClick={() => void handlePendingAction(msg.id, action.id, "cancel")}
                                            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-700 disabled:opacity-60"
                                          >
                                            取消
                                          </button>
                                        </div>
                                      )}
                                      {action.resultMessage && action.status !== "pending" && action.status !== "submitting" && (
                                        <p
                                          className={cn(
                                            "mt-2 flex items-start gap-1.5 text-xs leading-5",
                                            action.status === "executed" && "text-emerald-700",
                                            action.status === "canceled" && "text-slate-500",
                                            action.status === "failed" && "text-rose-600",
                                          )}
                                        >
                                          {action.status === "executed" && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                                          {action.status === "failed" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                                          <span>{action.resultMessage}</span>
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {/* 附件（图片缩略图 / 文件卡片） */}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className={cn("mt-2 flex flex-wrap gap-2", isUser ? "justify-end" : "justify-start")}>
                                  {msg.attachments.map((att) =>
                                    att.isImage && att.url ? (
                                      <MobileImagePreviewLink
                                        key={att.fileId}
                                        src={att.url}
                                        alt={att.name}
                                        downloadUrl={att.url}
                                        className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                                        title={att.name}
                                      >
                                        <img
                                          src={att.thumbnailUrl ?? att.url}
                                          alt={att.name}
                                          loading="lazy"
                                          decoding="async"
                                          className="max-h-44 max-w-[220px] object-cover"
                                        />
                                      </MobileImagePreviewLink>
                                    ) : (
                                      <a
                                        key={att.fileId}
                                        href={att.url ?? undefined}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={cn(
                                          "flex max-w-[240px] items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs transition",
                                          att.url
                                            ? "border-slate-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40"
                                            : "cursor-default border-slate-200 bg-white opacity-70",
                                        )}
                                        title={att.name}
                                      >
                                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                                          {att.isImage ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-slate-700">{att.name}</span>
                                          {att.size > 0 && (
                                            <span className="block text-[10px] text-slate-400">{fmtFileSize(att.size)}</span>
                                          )}
                                        </span>
                                      </a>
                                    ),
                                  )}
                                </div>
                              )}
                              <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
                                <span className="text-xs text-slate-400">{fmtTime(msg.createdAt)}</span>
                                {!isUser && msg.model && (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-400">
                                    {models.find((m) => m.id === msg.model)?.label ?? msg.model}
                                  </span>
                                )}
                                {!isUser && !isStreaming && msg.sources?.includes("db") && (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                    <Database className="h-2.5 w-2.5" />
                                    系统数据
                                  </span>
                                )}
                                {!isUser && !isStreaming && msg.sources?.includes("rag") && (
                                  <span className="flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                    <FileText className="h-2.5 w-2.5" />
                                    内部知识库
                                  </span>
                                )}
                                {!isUser && !isStreaming && msg.sources?.includes("web") && (
                                  <span className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                                    <Globe className="h-2.5 w-2.5" />
                                    联网检索
                                  </span>
                                )}
                                {!isUser && !isStreaming && msg.sources?.includes("attachment") && (
                                  <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                    <Paperclip className="h-2.5 w-2.5" />
                                    用户附件
                                  </span>
                                )}
                                {!isUser && !isStreaming && msg.sources?.includes("ai") && (
                                  <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                    <Sparkles className="h-2.5 w-2.5" />
                                    通用知识
                                  </span>
                                )}
                              </div>
                              {/* AI 消息操作栏 */}
                              {!isUser && !isStreaming && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                                  {[
                                    { key: "copy", icon: Copy, label: "复制", onClick: () => void copyText(msg.content, msg), active: false },
                                    { key: "refresh", icon: RefreshCw, label: "重新回答", onClick: () => void handleRefresh(msg.id), active: false },
                                    { key: "like", icon: ThumbsUp, label: "赞", onClick: () => void handleReaction(msg.id, "like"), active: msg.reaction === "like" },
                                    { key: "dislike", icon: ThumbsDown, label: msg.reaction === "dislike" ? "已反馈" : "踩", onClick: () => void handleReaction(msg.id, "dislike"), active: msg.reaction === "dislike" },
                                    { key: "share", icon: Share2, label: "分享", onClick: () => openShare(msg), active: false },
                                    { key: "delete", icon: Trash2, label: "删除", onClick: () => void handleDeleteMsg(msg.id), active: false },
                                  ].filter((item) => item.key !== "refresh" || msg.id === latestAssistantId).map(({ key, icon: Icon, label, onClick, active }) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={onClick}
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition",
                                        active
                                          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
                                      )}
                                    >
                                      <Icon className="h-3 w-3" />
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {!isUser && !isStreaming && feedbackDraft?.messageId === msg.id && (
                                <form
                                  className="mt-3 max-w-[640px] rounded-2xl border border-rose-200 bg-rose-50/70 p-4 shadow-sm"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void submitDislikeFeedback();
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <p className="text-sm font-semibold text-slate-900">这条回答哪里需要改进？</p>
                                      <p className="mt-1 text-xs text-slate-500">可多选，反馈只用于问题统计与后续分析。</p>
                                    </div>
                                    <button
                                      type="button"
                                      aria-label="关闭反馈"
                                      onClick={() => setFeedbackDraft(null)}
                                      className="cursor-pointer rounded-lg p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <fieldset className="mt-3">
                                    <legend className="sr-only">选择反馈原因</legend>
                                    <div className="flex flex-wrap gap-2">
                                      {DISLIKE_REASONS.map((reason) => {
                                        const selected = feedbackDraft.reasons.includes(reason.value);
                                        return (
                                          <button
                                            key={reason.value}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => setFeedbackDraft((current) => current ? {
                                              ...current,
                                              reasons: selected
                                                ? current.reasons.filter((value) => value !== reason.value)
                                                : [...current.reasons, reason.value],
                                            } : current)}
                                            className={cn(
                                              "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                                              selected
                                                ? "border-rose-300 bg-white text-rose-700"
                                                : "border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300",
                                            )}
                                          >
                                            {reason.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </fieldset>
                                  <label htmlFor={`feedback-comment-${msg.id}`} className="mt-3 block text-xs font-medium text-slate-700">
                                    补充说明 <span className="font-normal text-slate-400">（选填）</span>
                                  </label>
                                  <textarea
                                    id={`feedback-comment-${msg.id}`}
                                    value={feedbackDraft.comment}
                                    maxLength={500}
                                    rows={2}
                                    onChange={(event) => setFeedbackDraft((current) => current ? { ...current, comment: event.target.value } : current)}
                                    placeholder="例如：正确数量应该是 12，不是 9"
                                    className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                  />
                                  <div className="mt-3 flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setFeedbackDraft(null)}
                                      className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-white"
                                    >
                                      取消
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={submittingFeedback}
                                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {submittingFeedback && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                      提交反馈
                                    </button>
                                  </div>
                                </form>
                              )}
                              {/* 知识库引用：命中内部资料时由后端 SSE 推送 */}
                              {!isUser && !isStreaming && msgCitations[msg.id] && (
                                <div className="mt-2 max-w-[640px]">
                                  <RagCitations citations={msgCitations[msg.id].citations} onOpenSource={handleOpenSource} />
                                  <RagPermissionNotice filtered={msgCitations[msg.id].filteredByPermission} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* 输入区 */}
              <div className="border-t border-slate-200/70 bg-white px-6 py-4">
                {/* 快捷提问 */}
                <div className="mb-3 flex flex-wrap gap-2">
                  {(dynamicPrompts ?? QUICK_PROMPTS).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void handleSend(p)}
                      disabled={sending || !activeId}
                      className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40"
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50/92 p-3">
                  {/* 隐藏的文件选择器（由附件按钮触发） */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onPickFiles}
                  />
                  {/* 待发送附件预览条 */}
                  {attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {attachments.map((a) => (
                        <div
                          key={a.localId}
                          className={cn(
                            "group relative flex items-center gap-2 rounded-xl border bg-white py-1.5 pl-1.5 pr-7 text-xs",
                            a.status === "error" ? "border-red-200 bg-red-50" : "border-slate-200",
                          )}
                        >
                          {a.previewUrl ? (
                            <img src={a.previewUrl} alt={a.name} className="h-8 w-8 flex-shrink-0 rounded-md object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-indigo-50 text-indigo-500">
                              <FileText className="h-4 w-4" />
                            </span>
                          )}
                          <span className="min-w-0 max-w-[140px]">
                            <span className="block truncate font-medium text-slate-700">{a.name}</span>
                            <span
                              className={cn(
                                "block text-[10px]",
                                a.status === "error" ? "text-red-500" : "text-slate-400",
                              )}
                            >
                              {a.status === "uploading"
                                ? "上传中…"
                                : a.status === "compressing"
                                  ? "压缩中…"
                                  : a.status === "error"
                                    ? a.error ?? "上传失败"
                                    : fmtFileSize(a.size)}
                            </span>
                          </span>
                          {(a.status === "uploading" || a.status === "compressing") && (
                            <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-indigo-400" />
                          )}
                          {a.status === "error" && (
                            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                          )}
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.localId)}
                            className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
                            title="移除"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={onPasteInput}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    disabled={sending || !activeId}
                    className="material-scrollbar min-h-[72px] w-full resize-none bg-transparent text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-50"
                    placeholder={activeId ? "输入问题，Enter 发送，Shift+Enter 换行；可点击附件按钮 / 拖拽 / 粘贴上传" : "请先选择或新建一个对话"}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    {/* 模型选择器 */}
                    <div className="relative flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowModelMenu((v) => !v)}
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                        {currentModel
                          ? `${currentModel.label}${currentModel.model ? ` · ${currentModel.model}` : ""}`
                          : models.length === 0 ? "未配置模型" : "选择模型"}
                        <ChevronDown className="h-3 w-3 text-slate-400" />
                      </button>
                      {/* RAG 状态指示：告知用户当前是否能查到内部资料 */}
                      {rag && (
                        rag.embeddingConfigured && rag.chunkCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-100"
                            title={`内部知识库已就绪 · ${rag.chunkCount} 条索引（模型：${rag.embeddingModel ?? "未知"}）`}
                          >
                            <Database className="h-2.5 w-2.5" />
                            RAG 就绪
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200"
                            title={
                              rag.reason ??
                              (!rag.embeddingConfigured
                                ? "未配置 Embedding 模型，回答仅基于通用知识"
                                : "知识库尚未回填，请管理员触发回填")
                            }
                          >
                            <Database className="h-2.5 w-2.5" />
                            RAG 未启用
                          </span>
                        )
                      )}
                      {/* 一键回填：仅当「embedding 已配置但索引为空」且当前用户是 KB 管理员时出现 */}
                      {rag && rag.embeddingConfigured && rag.chunkCount === 0 && canBackfillRag && (
                        <button
                          type="button"
                          onClick={() => void handleBackfillRag()}
                          disabled={backfilling}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-600 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                          title="将知识库条目同步到 RAG 向量索引，使 AI 能检索内部资料（仅 KB 管理员可用）"
                        >
                          <RefreshCw className={cn("h-2.5 w-2.5", backfilling && "animate-spin")} />
                          {backfilling ? "回填中…" : "一键回填"}
                        </button>
                      )}
                      {showModelMenu && models.length > 0 && (
                        <div
                          className="absolute bottom-full left-0 mb-2 min-w-[180px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
                          onMouseLeave={() => setShowModelMenu(false)}
                        >
                          {models.map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => { setSelectedModel(m.id); setShowModelMenu(false); }}
                              className={cn(
                                "flex w-full flex-col px-4 py-2.5 text-left text-xs transition hover:bg-slate-50",
                                m.id === selectedModel ? "font-semibold text-indigo-600" : "text-slate-700",
                              )}
                            >
                              <span>{m.label}</span>
                              <span className={cn("mt-0.5 text-[10px]", m.id === selectedModel ? "text-indigo-400" : "text-slate-400")}>
                                {m.model}{m.provider ? ` · ${m.provider}` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* 附件按钮（点击上传，亦支持拖拽 / 粘贴） */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!activeId || sending || attachments.length >= ATTACH_MAX_COUNT}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
                        title={
                          attachments.length >= ATTACH_MAX_COUNT
                            ? `最多上传 ${ATTACH_MAX_COUNT} 个附件`
                            : "上传图片或文件（也可拖拽 / 粘贴）"
                        }
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>
                      {sending ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          className="material-button-primary"
                          title={t("停止生成（已生成的部分会保留）")}
                        >
                          <Square className="h-3.5 w-3.5 fill-current" />
                          {t("停止")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSend()}
                          disabled={!canSend}
                          className="material-button-primary disabled:opacity-50"
                        >
                          <Send className="h-4 w-4" />
                          {t("发送")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* 分享给同事：选一位同事，把这条回答作为站内消息发过去 */}
      {shareTarget && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4"
          onClick={() => setShareTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label="分享给同事"
        >
          <div
            className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">分享给同事</h3>
                <p className="mt-0.5 text-xs text-slate-400">对方会在通知中心 / 顶栏铃铛收到这条回答</p>
              </div>
              <button
                type="button"
                onClick={() => setShareTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-slate-100 px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={shareSearch}
                  onChange={(e) => setShareSearch(e.target.value)}
                  placeholder="搜索同事姓名 / 部门"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white"
                  autoFocus
                />
              </div>
              {!shareLoading && shareRecipients.length > 0 && (
                <p className="mt-2 px-0.5 text-xs text-slate-400">
                  {shareSearch.trim() ? `匹配到 ${shareGroups.total} 位同事` : `共 ${shareGroups.total} 位同事`}
                </p>
              )}
            </div>
            <div className="material-scrollbar flex-1 overflow-y-auto px-2 pb-2">
              {shareLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载同事列表…
                </div>
              ) : shareGroups.total === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  {shareRecipients.length === 0 ? "没有可分享的同事" : "没有匹配的同事"}
                </div>
              ) : (
                shareGroups.groups.map((g) => (
                  <div key={g.dept} className="mb-0.5">
                    <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-3 py-1.5 backdrop-blur">
                      <span className="text-xs font-semibold text-slate-500">{g.dept}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium leading-5 text-slate-400">
                        {g.items.length}
                      </span>
                    </div>
                    {g.items.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        disabled={shareSendingId !== null}
                        onClick={() => {
                          const steps = shareTarget ? msgToolSteps[shareTarget.id] ?? [] : [];
                          const refsTask = steps.some((s) => TASK_REF_TOOLS.has(s.tool) && s.status !== "error");
                          if (refsTask) setShareConfirm(r);
                          else void shareToColleague(r);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-indigo-50/60 disabled:cursor-wait disabled:opacity-60"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                          {r.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{r.name}</span>
                        {shareSendingId === r.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-500" />}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 越权分享确认：回答引用了任务数据，收件人可能无权查看，交由发送者决断 */}
          {shareConfirm && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4"
              onClick={(e) => {
                e.stopPropagation();
                setShareConfirm(null);
              }}
            >
              <div
                className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-slate-900">这条回答引用了任务数据</h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      <span className="font-medium text-slate-700">{shareConfirm.name}</span>{" "}
                      可能无权查看其中部分任务，分享后对方将看到完整正文。仍要分享吗？
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShareConfirm(null)}
                    className="material-button-secondary !px-4 !py-1.5 text-xs"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={shareSendingId !== null}
                    onClick={() => {
                      const r = shareConfirm;
                      setShareConfirm(null);
                      void shareToColleague(r);
                    }}
                    className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    仍要分享
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
