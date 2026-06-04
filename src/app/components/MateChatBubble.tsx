import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
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
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { authFetch } from "../lib/authSession";
import { useAuth } from "../auth";
import { cn } from "./ui/utils";
import { backfillKbToRag, ragStatus, type RagCitation, type RagStatus } from "../lib/ragApi";
import { hasPermission } from "../lib/permissions";
import { RagCitations, RagPermissionNotice } from "./RagCitations";

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
  isImage: boolean;
};

type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  reaction: string | null;
  attachments?: AttachmentView[];
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
  | { type: "context"; fromDb: boolean }
  | { type: "citations"; citations: RagCitation[]; filteredByPermission: number }
  | { type: "delta"; delta: string }
  | { type: "done"; messageId: string; title?: string }
  | { type: "error"; message: string };

/** assistant 消息附加的引用数据，由 'citations' SSE 事件填充 */
type MessageCitations = { citations: RagCitation[]; filteredByPermission: number };

type DeleteConfirm =
  | { kind: "conversation"; id: string; label: string }
  | { kind: "message"; id: string }
  | null;

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const FLOATING_MARGIN = 24;
const FLOATING_FALLBACK_SIZE = { width: 224, height: 72 };
const AI_AVATAR = "https://matechat.gitcode.com/logo.svg";

const QUICK_PROMPTS = [
  "帮我整理今天的关键待办",
  "帮我起草一封客户跟进邮件",
  "总结当前项目的风险点",
  "给我一份合同审查意见模板",
];

/** 附件数量与单文件大小上限（与后端 uploads-temp 的 20MB 对齐） */
const ATTACH_MAX_COUNT = 10;
const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

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

/** canvas.toBlob 的 Promise 包装 */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** 压缩后统一输出 JPEG，把文件名扩展名换成 .jpg */
function renameToJpg(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base || "image"}.jpg`;
}

/**
 * 客户端压缩图片到 maxBytes 以内：先把最长边限制到 2560px，再逐级降低 JPEG 质量；
 * 仍超限则进一步缩小尺寸重试。解码失败或压到最小仍超限返回 null（调用方据此提示）。
 */
async function compressImageToLimit(file: File, maxBytes: number): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null; // 浏览器无法解码（如 HEIC）
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    let maxEdge = Math.min(Math.max(bitmap.width, bitmap.height), 2560);
    for (let i = 0; i < 8 && maxEdge >= 480; i++) {
      const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * ratio));
      const h = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.width = w;
      canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff"; // JPEG 无透明通道，铺白底避免黑块
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const quality of [0.82, 0.7, 0.6, 0.5]) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= maxBytes) {
          return new File([blob], renameToJpg(file.name), {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
      maxEdge = Math.round(maxEdge * 0.75); // 仍超限则进一步缩小尺寸
    }
    return null;
  } finally {
    bitmap.close();
  }
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
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
    y: Math.max(FLOATING_MARGIN, window.innerHeight - height - FLOATING_MARGIN),
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

async function apiUpdateReaction(msgId: string, reaction: string | null): Promise<void> {
  await authFetch(`/api/chat/messages/${msgId}/reaction`, {
    method: "PATCH",
    body: JSON.stringify({ reaction }),
  });
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
  const form = new FormData();
  form.append("file", file);
  form.append("businessType", "uploads-temp");
  // 注意：FormData 不能手动设 Content-Type（authFetch 仅对 string body 加 JSON 头，这里会让浏览器自动带 boundary）
  const res = await authFetch("/api/files/upload", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? "上传失败");
  }
  return res.json() as Promise<UploadResult>;
}

async function apiListModels(): Promise<ModelOption[]> {
  const res = await authFetch("/api/chat/models");
  if (!res.ok) return [];
  const all = (await res.json()) as ModelOption[];
  // 图片生成模型不支持对话（后端已过滤，前端再加一层防护）
  return all.filter((m) => {
    if (m.usage_kind === "image") return false;
    if (m.usage_kind && m.usage_kind !== "auto") return true;
    const n = m.model.toLowerCase();
    return !(n.includes("gpt-image") || n.includes("image-to-image") || n === "dall-e-2" || n.startsWith("dall-e-"));
  });
}

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

  // 对话框
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);

  // 数据
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  // UI 状态
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm>(null);
  // key = message id, value = 'db' | 'ai'
  const [msgSources, setMsgSources] = useState<Record<string, "db" | "ai">>({});
  // key = message id, value = 引用数据（命中知识库时由后端 SSE 推送）
  const [msgCitations, setMsgCitations] = useState<Record<string, MessageCitations>>({});
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

  // ── 气泡位置初始化 + resize 归位 ───────────────────────────────────────────

  useEffect(() => {
    setBubblePos(getDefaultFloatingPosition(bubbleRef.current));
    setBubbleReady(true);
  }, []);

  useEffect(() => {
    if (!bubbleReady) return;
    const el = bubbleRef.current;
    if (el) { el.style.left = `${bubblePos.x}px`; el.style.top = `${bubblePos.y}px`; }
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

  // ── 切换会话时加载消息 ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeId) return;
    setLoadingMsgs(true);
    setMessages([]);
    apiGetMessages(activeId)
      .then((msgs) => setMessages(msgs))
      .catch((err) => toast.error(err instanceof Error ? err.message : "加载消息失败"))
      .finally(() => setLoadingMsgs(false));
  }, [activeId]);

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
        compressed = await compressImageToLimit(file, ATTACH_MAX_BYTES);
      } catch {
        compressed = null;
      }
      if (!compressed) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.localId === localId
              ? { ...a, status: "error", error: "图片过大，压缩后仍超过 20MB" }
              : a,
          ),
        );
        toast.error(`「${file.name}」过大，压缩后仍超过 20MB，已跳过`);
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
        if (file.size > ATTACH_MAX_BYTES) {
          // 非图片无法压缩，仍跳过；超大图片先占位再压缩
          if (!isImg) {
            toast.error(`「${file.name}」超过 20MB，已跳过`);
            continue;
          }
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
    async (preset?: string) => {
      if (!activeId || sending) return;
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
      const now = new Date().toISOString();

      // 乐观添加占位消息
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", content, model: null, reaction: null, createdAt: now, attachments: optimisticAtts },
        { id: tempAiId, role: "assistant", content: "", model: selectedModel || null, reaction: null, createdAt: now },
      ]);

      try {
        const res = await authFetch(`/api/chat/conversations/${activeId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: content || undefined,
            model: selectedModel || undefined,
            attachments: attachPayload.length > 0 ? attachPayload : undefined,
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(err.message ?? "发送失败");
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let realUserId = tempUserId;
        let streamedContent = "";
        let currentFromDb = false;

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
              }

              if (event.type === "citations") {
                // 临时挂到 tempAiId 上；done 事件里替换为 realAiId 时一起搬过去
                setMsgCitations((prev) => ({
                  ...prev,
                  [tempAiId]: { citations: event.citations, filteredByPermission: event.filteredByPermission },
                }));
              }

              if (event.type === "delta") {
                streamedContent += event.delta;
                const captured = streamedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, content: captured } : m)),
                );
              }

              if (event.type === "done") {
                const realAiId = event.messageId;
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempAiId ? { ...m, id: realAiId } : m)),
                );
                setMsgSources((prev) => ({ ...prev, [realAiId]: currentFromDb ? "db" : "ai" }));
                setMsgCitations((prev) => {
                  if (!prev[tempAiId]) return prev;
                  const { [tempAiId]: pulled, ...rest } = prev;
                  return { ...rest, [realAiId]: pulled };
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
                // 清掉占位的用户消息 + AI 占位，避免用户看到"自己发了消息但永远没回复"的孤儿
                setMessages((prev) =>
                  prev.filter((m) => m.id !== tempUserId && m.id !== tempAiId),
                );
              }
            } catch {
              // ignore JSON parse errors
            }
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "发送失败");
        setMessages((prev) => prev.filter((m) => m.id !== tempUserId && m.id !== tempAiId));
      } finally {
        setSending(false);
        void (realUserId); // suppress unused warning
      }
    },
    [activeId, sending, draft, selectedModel, attachments],
  );

  // ── 重新生成 ────────────────────────────────────────────────────────────────

  const handleRefresh = async (msgId: string) => {
    if (!activeId || sending) return;
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx <= 0) return;
    const prevUser = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!prevUser) { toast.error("找不到上一条问题"); return; }
    try {
      await apiDeleteMessage(msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch { /* ignore, still try to regenerate */ }
    await handleSend(prevUser.content);
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
    const next = msg.reaction === reaction ? null : reaction;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reaction: next } : m)));
    await apiUpdateReaction(msgId, next).catch(() => {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reaction: msg.reaction } : m)));
    });
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

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
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
          // 直接操作 DOM，零 React 渲染
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
        style={{ left: bubblePos.x, top: bubblePos.y }}
        className={cn(
          "fixed z-50 flex items-center gap-3 rounded-full border border-white/70 bg-indigo-600 px-4 py-3 text-white shadow-[0_18px_38px_rgba(79,70,229,0.28)] transition-all duration-200 cursor-grab hover:-translate-y-1 hover:scale-[1.02] will-change-[left,top]",
          bubbleReady ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/14">
          <img src={AI_AVATAR} alt="MateChat" className="h-7 w-7 object-contain" />
          <span className="absolute inset-[-5px] rounded-full border border-indigo-300/30 animate-pulse" />
        </span>
        <span className="hidden sm:block">
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
                <div className="ml-4 flex items-center gap-2">
                  {activeConv && (
                    <>
                      <button
                        type="button"
                        onClick={() => void togglePin()}
                        className="material-button-secondary px-3 py-2 text-xs"
                      >
                        <Pin className="h-4 w-4" />
                        {activeConv.pinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRenameTitle(activeConv.title); setIsRenaming(true); }}
                        className="material-button-secondary px-3 py-2 text-xs"
                      >
                        <PencilLine className="h-4 w-4" />
                        重命名
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeConversation()}
                        className="material-button-secondary px-3 py-2 text-xs text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                        删除
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500 transition hover:text-slate-900"
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
                              {(msg.content || isStreaming) && (
                                <div
                                  className={cn(
                                    "rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm",
                                    isUser ? "rounded-tr-md bg-indigo-50 text-slate-800" : "rounded-tl-md bg-[#f5f5fb] text-slate-800",
                                    isStreaming && !msg.content && "py-4",
                                  )}
                                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                                >
                                  {isStreaming && !msg.content ? (
                                    <span className="flex items-center gap-1.5">
                                      {[0, 1, 2].map((i) => (
                                        <span
                                          key={i}
                                          className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
                                          style={{ animationDelay: `${i * 160}ms`, animationDuration: "0.72s" }}
                                        />
                                      ))}
                                    </span>
                                  ) : (
                                    <>
                                      {msg.content}
                                      {isStreaming && (
                                        <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle" />
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                              {/* 附件（图片缩略图 / 文件卡片） */}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className={cn("mt-2 flex flex-wrap gap-2", isUser ? "justify-end" : "justify-start")}>
                                  {msg.attachments.map((att) =>
                                    att.isImage && att.url ? (
                                      <a
                                        key={att.fileId}
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                                        title={att.name}
                                      >
                                        <img src={att.url} alt={att.name} className="max-h-44 max-w-[220px] object-cover" />
                                      </a>
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
                                {!isUser && !isStreaming && msgSources[msg.id] === "db" && (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                    <Database className="h-2.5 w-2.5" />
                                    系统数据
                                  </span>
                                )}
                                {!isUser && !isStreaming && msgSources[msg.id] === "ai" && (
                                  <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                    <Globe className="h-2.5 w-2.5" />
                                    通用知识
                                  </span>
                                )}
                              </div>
                              {/* AI 消息操作栏 */}
                              {!isUser && !isStreaming && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                                  {[
                                    { key: "copy", icon: Copy, label: "复制", onClick: () => void copyText(msg.content), active: false },
                                    { key: "refresh", icon: RefreshCw, label: "重新回答", onClick: () => void handleRefresh(msg.id), active: false },
                                    { key: "like", icon: ThumbsUp, label: "赞", onClick: () => void handleReaction(msg.id, "like"), active: msg.reaction === "like" },
                                    { key: "dislike", icon: ThumbsDown, label: "踩", onClick: () => void handleReaction(msg.id, "dislike"), active: msg.reaction === "dislike" },
                                    { key: "share", icon: Share2, label: "分享", onClick: () => void copyText(msg.content), active: false },
                                    { key: "delete", icon: Trash2, label: "删除", onClick: () => void handleDeleteMsg(msg.id), active: false },
                                  ].map(({ key, icon: Icon, label, onClick, active }) => (
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
                              {/* 知识库引用：命中内部资料时由后端 SSE 推送 */}
                              {!isUser && !isStreaming && msgCitations[msg.id] && (
                                <div className="mt-2 max-w-[640px]">
                                  <RagCitations citations={msgCitations[msg.id].citations} />
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
                  {QUICK_PROMPTS.map((p) => (
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
                      <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={!canSend}
                        className="material-button-primary disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        {sending ? "发送中…" : "发送"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
