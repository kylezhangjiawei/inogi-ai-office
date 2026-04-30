import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock3,
  Copy,
  Database,
  Globe,
  MessageSquarePlus,
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

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type ApiConversation = {
  id: string;
  title: string;
  summary: string;
  pinned: boolean;
  updatedAt: string;
  _count?: { messages: number };
};

type ApiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  reaction: string | null;
  createdAt: string;
};

type ModelOption = { id: string; label: string; provider: string };

type SseEvent =
  | { type: "userMessage"; messageId: string }
  | { type: "context"; fromDb: boolean }
  | { type: "delta"; delta: string }
  | { type: "done"; messageId: string; title?: string }
  | { type: "error"; message: string };

type DeleteConfirm =
  | { kind: "conversation"; id: string; label: string }
  | { kind: "message"; id: string }
  | null;

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const FLOATING_POS_KEY = "inogi-matechat-floating-position";
const AI_AVATAR = "https://matechat.gitcode.com/logo.svg";

const QUICK_PROMPTS = [
  "帮我整理今天的关键待办",
  "帮我起草一封客户跟进邮件",
  "总结当前项目的风险点",
  "给我一份合同审查意见模板",
];

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

async function apiListModels(): Promise<ModelOption[]> {
  const res = await authFetch("/api/chat/models");
  if (!res.ok) return [];
  return res.json() as Promise<ModelOption[]>;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function MateChatBubble() {
  const { user } = useAuth();

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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── 气泡位置初始化 + resize clamp ──────────────────────────────────────────

  useEffect(() => {
    const def = { x: Math.max(16, window.innerWidth - 224), y: Math.max(16, window.innerHeight - 112) };
    let pos = def;
    try {
      const raw = window.localStorage.getItem(FLOATING_POS_KEY);
      const parsed = raw ? (JSON.parse(raw) as { x?: number; y?: number }) : null;
      if (parsed) pos = { x: parsed.x ?? def.x, y: parsed.y ?? def.y };
    } catch { /* ignore */ }
    setBubblePos(pos);
    setBubbleReady(true);
  }, []);

  // 拖动结束后同步 state → 触发 localStorage 写入
  useEffect(() => {
    if (!bubbleReady) return;
    window.localStorage.setItem(FLOATING_POS_KEY, JSON.stringify(bubblePos));
    // 同时把 DOM 位置对齐（避免 resize 后出现偏差）
    const el = bubbleRef.current;
    if (el) { el.style.left = `${bubblePos.x}px`; el.style.top = `${bubblePos.y}px`; }
  }, [bubblePos, bubbleReady]);

  useEffect(() => {
    if (!bubbleReady) return;
    const clamp = () => {
      const el = bubbleRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setBubblePos((p) => ({
        x: Math.min(Math.max(16, p.x), Math.max(16, window.innerWidth - w - 16)),
        y: Math.min(Math.max(16, p.y), Math.max(16, window.innerHeight - h - 16)),
      }));
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
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

  // ── 首次打开加载数据 ────────────────────────────────────────────────────────

  const loadInit = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const [convs, mds] = await Promise.all([apiListConversations(), apiListModels()]);
      setConversations(convs);
      setModels(mds);
      if (mds.length > 0 && !selectedModel) setSelectedModel(mds[0].id);
      if (convs.length > 0 && !activeId) setActiveId(convs[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoadingConvs(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (open) void loadInit(); }, [open, loadInit]);

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

  // ── 发送消息（支持流式响应）────────────────────────────────────────────────

  const handleSend = useCallback(
    async (preset?: string) => {
      if (!activeId || sending) return;
      const content = (preset ?? draft).trim();
      if (!content) return;

      setDraft("");
      setSending(true);

      const tempUserId = `tmp-user-${Date.now()}`;
      const tempAiId = `tmp-ai-${Date.now()}`;
      const now = new Date().toISOString();

      // 乐观添加占位消息
      setMessages((prev) => [
        ...prev,
        { id: tempUserId, role: "user", content, model: null, reaction: null, createdAt: now },
        { id: tempAiId, role: "assistant", content: "", model: selectedModel || null, reaction: null, createdAt: now },
      ]);

      try {
        const res = await authFetch(`/api/chat/conversations/${activeId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content, model: selectedModel || undefined }),
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
                setMessages((prev) => prev.filter((m) => m.id !== tempAiId));
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
    [activeId, sending, draft, selectedModel],
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
          const x = Math.min(Math.max(16, dragStartRef.current.x + dx), window.innerWidth - w - 16);
          const y = Math.min(Math.max(16, dragStartRef.current.y + dy), window.innerHeight - h - 16);
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
          // 拖动结束：把 DOM 实际位置同步回 React state（用于 localStorage）
          const x = parseFloat(el.style.left) || bubblePos.x;
          const y = parseFloat(el.style.top) || bubblePos.y;
          setBubblePos({ x, y });
        }}
        onClick={() => { if (!movedRef.current) setOpen(true); movedRef.current = false; }}
        style={{ left: bubblePos.x, top: bubblePos.y }}
        className={cn(
          "fixed z-50 flex items-center gap-3 rounded-full border border-white/70 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.32),transparent_42%),linear-gradient(135deg,#2f80ed_0%,#2563eb_45%,#0f9fb3_100%)] px-4 py-3 text-white shadow-[0_18px_38px_rgba(37,99,235,0.28)] transition-all duration-200 cursor-grab hover:-translate-y-1 hover:scale-[1.02] will-change-[left,top]",
          bubbleReady ? "opacity-100" : "opacity-0",
        )}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/14">
          <img src={AI_AVATAR} alt="MateChat" className="h-7 w-7 object-contain" />
          <span className="absolute inset-[-5px] rounded-full border border-sky-300/30 animate-pulse" />
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
              "absolute inset-y-4 right-4 flex h-[calc(100vh-32px)] w-[min(1120px,calc(100vw-32px),50vw)] max-w-[calc(100vw-32px)] overflow-hidden rounded-[32px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.95))] shadow-[0_30px_80px_rgba(15,23,42,0.26)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              visible ? "translate-x-0 scale-100 opacity-100" : "translate-x-8 scale-[0.98] opacity-0",
            )}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="MateChat"
          >
            {/* 左侧会话列表 */}
            <section className="flex w-[30%] min-w-[240px] flex-col border-r border-slate-200/70 bg-[linear-gradient(180deg,#f6f9ff_0%,#eef5fd_100%)]">
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
                            ? "border-blue-100 bg-[linear-gradient(135deg,#edf4ff_0%,#e8f4ff_72%,#eefaf8_100%)] shadow-[0_16px_30px_rgba(25,118,210,0.12)]"
                            : "border-slate-200/80 bg-white/82 hover:border-slate-300 hover:bg-white",
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="truncate text-sm font-semibold text-slate-900">{conv.title}</div>
                          {conv.pinned && <Pin className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />}
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
            <section className="flex min-w-0 flex-1 flex-col">
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
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
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
              <div className="material-scrollbar flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fd_100%)] px-6 py-6">
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
                              <div
                                className={cn(
                                  "rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm",
                                  isUser ? "rounded-tr-md bg-[#f0f4ff] text-slate-800" : "rounded-tl-md bg-[#f5f5fb] text-slate-800",
                                )}
                                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                              >
                                {msg.content}
                                {isStreaming && (
                                  <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle" />
                                )}
                              </div>
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
                                  <span className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600">
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
                                          ? "border-blue-200 bg-blue-50 text-blue-700"
                                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
                                      )}
                                    >
                                      <Icon className="h-3 w-3" />
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* 流式输入中的三点动画（仅在流还未返回任何内容时显示） */}
                    {sending && messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex">
                        <div className="flex max-w-[82%] gap-3">
                          <div className="mt-1 flex h-10 w-10 items-center justify-center">
                            <img src={AI_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />
                          </div>
                          <div className="rounded-[24px] rounded-tl-md bg-[#f5f5fb] px-4 py-4 shadow-sm">
                            <div className="flex items-center gap-2">
                              {[0, 1, 2].map((i) => (
                                <span
                                  key={i}
                                  className="h-2.5 w-2.5 rounded-full bg-[#c5b4ff] animate-pulse"
                                  style={{ animationDelay: `${i * 150}ms` }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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
                      className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-40"
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50/92 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    disabled={sending || !activeId}
                    className="material-scrollbar min-h-[72px] w-full resize-none bg-transparent text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-50"
                    placeholder={activeId ? "输入问题，Enter 发送，Shift+Enter 换行" : "请先选择或新建一个对话"}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    {/* 模型选择器 */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowModelMenu((v) => !v)}
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                        {currentModel?.label ?? (models.length === 0 ? "未配置模型" : "选择模型")}
                        <ChevronDown className="h-3 w-3 text-slate-400" />
                      </button>
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
                                "flex w-full items-center justify-between px-4 py-2.5 text-xs transition hover:bg-slate-50",
                                m.id === selectedModel ? "font-semibold text-blue-600" : "text-slate-700",
                              )}
                            >
                              <span>{m.label}</span>
                              <span className="ml-3 text-[10px] text-slate-400">{m.provider}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={sending || !draft.trim() || !activeId}
                      className="material-button-primary disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? "发送中…" : "发送"}
                    </button>
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
