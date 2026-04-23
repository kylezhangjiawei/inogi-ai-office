import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock3,
  Copy,
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
import { useAuth } from "../auth";
import { cn } from "./ui/utils";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  time: string;
};

type Conversation = {
  id: string;
  title: string;
  summary: string;
  pinned: boolean;
  updatedAt: string;
  messages: ChatMessage[];
};

type MessageReaction = {
  like?: boolean;
  dislike?: boolean;
};

type ToolbarAction = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  isActive?: boolean;
};

const STORAGE_KEY = "inogi-matechat-conversations";
const FLOATING_BUTTON_POSITION_KEY = "inogi-matechat-floating-position";
const AI_AVATAR = "https://matechat.gitcode.com/logo.svg";
const MOJIBAKE_REPLACEMENTS = [
  ["瀵硅瘽鍘嗗彶", "对话历史"],
  ["鏂板缓", "新建"],
  ["鎼滅储鑱婂ぉ鍐呭", "搜索聊天内容"],
  ["娌℃壘鍒板尮閰嶇殑浼氳瘽锛岃瘯璇曟柊寤轰竴涓棶棰樸€?", "没找到匹配的会话，试试新建一个问题。"],
  ["鍙栨秷缃《", "取消置顶"],
  ["缃《", "置顶"],
  ["閲嶅懡鍚?", "重命名"],
  ["鍒犻櫎", "删除"],
  ["杈撳叆鏂扮殑浼氳瘽鏍囬", "输入新的会话标题"],
  ["淇濆瓨", "保存"],
  ["鍙栨秷", "取消"],
  ["澶嶅埗", "复制"],
  ["閲嶆柊鍥炵瓟", "重新回答"],
  ["鐐硅禐", "点赞"],
  ["鐐硅俯", "点踩"],
  ["鍒嗕韩", "分享"],
] as const;

const QUICK_PROMPTS = [
  "帮我整理今天首页上的关键待办",
  "帮我起草一封给客户的英文跟进邮件",
  "总结当前注册项目的风险点",
  "给我一份合同审查意见模板",
];

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function nowDateTime() {
  return new Date().toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeMateChatText(value: string) {
  return MOJIBAKE_REPLACEMENTS.reduce((result, [badText, goodText]) => result.split(badText).join(goodText), value);
}

function normalizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    title: normalizeMateChatText(conversation.title),
    summary: normalizeMateChatText(conversation.summary),
    messages: conversation.messages.map((message) => ({
      ...message,
      content: normalizeMateChatText(message.content),
    })),
  };
}

function makeAssistantReply(input: string) {
  if (input.includes("待办") || input.includes("首页")) {
    return "我先给你整理一个工作摘要：\n\n1. 售后模块里仍有紧急工单需要优先跟进。\n2. 注册项目里程碑还有资料缺口待补齐。\n3. 质量 DMS 与合同审查各有待确认节点。\n\n如果你愿意，我可以继续按模块拆成负责人和处理建议。";
  }

  if (input.includes("邮件") || input.includes("客户")) {
    return "下面是一版适合客户跟进的英文邮件草稿：\n\nSubject: Follow-up on Pending Items\n\nDear [Customer Name],\n\nI hope you are doing well. We are following up on the pending items discussed previously. Please let us know whether there are any updates on your side, and feel free to share any additional documents required.\n\nBest regards,\nINOGI Team";
  }

  if (input.includes("注册") || input.includes("风险")) {
    return "当前注册项目建议重点关注：\n\n- 资料版本是否一致\n- 样机与注册配置是否完全匹配\n- 各节点责任人是否明确\n- 外部法规更新是否同步到项目文档\n\n如果你要，我可以继续输出成项目风险清单。";
  }

  if (input.includes("合同") || input.includes("审查")) {
    return "合同审查意见模板建议包含：\n\n- 基本信息与交易背景\n- 关键风险条款\n- 建议修改意见\n- 是否需要法务复核\n- 风险等级结论\n\n你也可以把条款内容贴给我，我按这个模板帮你整理。";
  }

  return `已收到你的问题：${input}\n\nMateChat 当前接的是演示能力，我已经记录到当前会话。你可以继续补充上下文，比如：\n- 你想输出什么结果\n- 用中文还是英文\n- 需要简版还是正式版\n\n我会继续基于这条会话往下整理。`;
}

function buildSeedConversations(userName: string) {
  return [
    {
      id: "chat-1",
      title: "今日工作摘要",
      summary: "首页待办与跨模块动态整理",
      pinned: true,
      updatedAt: nowDateTime(),
      messages: [
        {
          id: "m-1",
          role: "assistant" as const,
          content: `你好，${userName}。我是 MateChat，可以帮你整理待办、起草文档、总结业务信息。`,
          time: nowTime(),
        },
        {
          id: "m-2",
          role: "user" as const,
          content: "帮我整理今天首页上的关键待办",
          time: nowTime(),
        },
        {
          id: "m-3",
          role: "assistant" as const,
          content: "今天建议优先关注售后紧急工单、注册项目资料缺口，以及质量 DMS 审批节点。我也可以继续按模块展开。",
          time: nowTime(),
        },
      ],
    },
    {
      id: "chat-2",
      title: "客户英文邮件",
      summary: "对外跟进邮件草稿",
      pinned: false,
      updatedAt: nowDateTime(),
      messages: [
        {
          id: "m-4",
          role: "assistant" as const,
          content: "把你的沟通目标告诉我，我可以直接起草英文邮件。",
          time: nowTime(),
        },
      ],
    },
  ] satisfies Conversation[];
}

export function MateChatBubble() {
  const { user } = useAuth();
  const seedConversations = useMemo(() => buildSeedConversations(user?.name ?? "同事"), [user?.name]);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, pointerX: 0, pointerY: 0 });
  const movedDuringDragRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [renderDialog, setRenderDialog] = useState(false);
  const [animateVisible, setAnimateVisible] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>(seedConversations);
  const [activeId, setActiveId] = useState(seedConversations[0]?.id ?? "");
  const [keyword, setKeyword] = useState("");
  const [draft, setDraft] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [messageReactions, setMessageReactions] = useState<Record<string, MessageReaction>>({});
  const [bubblePosition, setBubblePosition] = useState({ x: 0, y: 0 });
  const [bubbleReady, setBubbleReady] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Conversation[];
      const normalized = parsed.map(normalizeConversation);
      if (normalized.length > 0) {
        setConversations(normalized);
        setActiveId(normalized[0].id);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    const defaultPosition = {
      x: Math.max(16, window.innerWidth - 224),
      y: Math.max(16, window.innerHeight - 112),
    };

    const raw = window.localStorage.getItem(FLOATING_BUTTON_POSITION_KEY);
    if (!raw) {
      setBubblePosition(defaultPosition);
      setBubbleReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { x?: number; y?: number };
      setBubblePosition({
        x: typeof parsed.x === "number" ? parsed.x : defaultPosition.x,
        y: typeof parsed.y === "number" ? parsed.y : defaultPosition.y,
      });
    } catch {
      window.localStorage.removeItem(FLOATING_BUTTON_POSITION_KEY);
      setBubblePosition(defaultPosition);
    } finally {
      setBubbleReady(true);
    }
  }, []);

  useEffect(() => {
    if (!bubbleReady) return;
    window.localStorage.setItem(FLOATING_BUTTON_POSITION_KEY, JSON.stringify(bubblePosition));
  }, [bubblePosition, bubbleReady]);

  useEffect(() => {
    if (!bubbleReady) return;

    const clampPosition = () => {
      const bubble = bubbleRef.current;
      const width = bubble?.offsetWidth ?? 184;
      const height = bubble?.offsetHeight ?? 64;
      const maxX = Math.max(16, window.innerWidth - width - 16);
      const maxY = Math.max(16, window.innerHeight - height - 16);

      setBubblePosition((prev) => ({
        x: Math.min(Math.max(16, prev.x), maxX),
        y: Math.min(Math.max(16, prev.y), maxY),
      }));
    };

    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [bubbleReady]);

  useEffect(() => {
    if (!dragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bubble = bubbleRef.current;
      const width = bubble?.offsetWidth ?? 184;
      const height = bubble?.offsetHeight ?? 64;
      const nextX = dragStartRef.current.x + (event.clientX - dragStartRef.current.pointerX);
      const nextY = dragStartRef.current.y + (event.clientY - dragStartRef.current.pointerY);
      const clampedX = Math.min(Math.max(16, nextX), Math.max(16, window.innerWidth - width - 16));
      const clampedY = Math.min(Math.max(16, nextY), Math.max(16, window.innerHeight - height - 16));

      if (Math.abs(event.clientX - dragStartRef.current.pointerX) > 4 || Math.abs(event.clientY - dragStartRef.current.pointerY) > 4) {
        movedDuringDragRef.current = true;
      }

      setBubblePosition({ x: clampedX, y: clampedY });
    };

    const handlePointerUp = () => {
      setDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (open) {
      setRenderDialog(true);
      const timer = window.setTimeout(() => setAnimateVisible(true), 16);
      return () => window.clearTimeout(timer);
    }

    setAnimateVisible(false);
    if (!renderDialog) {
      return undefined;
    }

    const timer = window.setTimeout(() => setRenderDialog(false), 260);
    return () => window.clearTimeout(timer);
  }, [open, renderDialog]);

  const filteredConversations = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    const ordered = [...conversations].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    if (!normalized) return ordered;
    return ordered.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(normalized) ||
        conversation.summary.toLowerCase().includes(normalized) ||
        conversation.messages.some((message) => message.content.toLowerCase().includes(normalized)),
    );
  }, [conversations, keyword]);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ??
    filteredConversations[0] ??
    conversations[0] ??
    null;

  useEffect(() => {
    if (!activeConversation && conversations[0]) {
      setActiveId(conversations[0].id);
    }
  }, [activeConversation, conversations]);

  const createConversation = () => {
    const nextConversation: Conversation = {
      id: `chat-${Date.now()}`,
      title: `新对话 ${conversations.length + 1}`,
      summary: "等待输入新问题",
      pinned: false,
      updatedAt: nowDateTime(),
      messages: [
        {
          id: `m-${Date.now()}`,
          role: "assistant",
          content: `新会话已创建。你好，${user?.name ?? "同事"}，告诉我你现在想处理什么内容。`,
          time: nowTime(),
        },
      ],
    };

    setConversations((prev) => [nextConversation, ...prev]);
    setActiveId(nextConversation.id);
    setDraft("");
    setIsRenaming(false);
    toast.success("已新建 MateChat 对话");
  };

  const handleSend = (preset?: string) => {
    if (!activeConversation || isTyping) return;
    const content = (preset ?? draft).trim();
    if (!content) return;

    const userMessage: ChatMessage = {
      id: `m-${Date.now()}`,
      role: "user",
      content,
      time: nowTime(),
    };

    const conversationTitle =
      activeConversation.messages.length <= 1 ? content.slice(0, 16) || activeConversation.title : activeConversation.title;

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              title: conversationTitle,
              summary: content.slice(0, 28),
              updatedAt: nowDateTime(),
              messages: [...conversation.messages, userMessage],
            }
          : conversation,
      ),
    );
    setDraft("");
    setIsTyping(true);

    window.setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: `m-${Date.now() + 1}`,
        role: "assistant",
        content: makeAssistantReply(content),
        time: nowTime(),
      };

      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversation.id
            ? {
                ...conversation,
                updatedAt: nowDateTime(),
                summary: assistantMessage.content.slice(0, 28),
                messages: [...conversation.messages, assistantMessage],
              }
            : conversation,
        ),
      );
      setIsTyping(false);
    }, 900);
  };

  const togglePin = () => {
    if (!activeConversation) return;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id ? { ...conversation, pinned: !conversation.pinned } : conversation,
      ),
    );
  };

  const startRename = () => {
    if (!activeConversation) return;
    setRenameTitle(activeConversation.title);
    setIsRenaming(true);
  };

  const confirmRename = () => {
    if (!activeConversation) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle) return;
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id ? { ...conversation, title: nextTitle, updatedAt: nowDateTime() } : conversation,
      ),
    );
    setIsRenaming(false);
    toast.success("会话标题已更新");
  };

  const removeConversation = () => {
    if (!activeConversation) return;
    const remaining = conversations.filter((conversation) => conversation.id !== activeConversation.id);
    const fallback = remaining.length > 0 ? remaining : buildSeedConversations(user?.name ?? "同事");
    setConversations(fallback);
    setActiveId(fallback[0].id);
    setIsRenaming(false);
    toast.success("会话已删除");
  };

  const writeClipboardText = async (content: string, successMessage: string, fallbackMessage: string) => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("clipboard-unavailable");
      }
      await navigator.clipboard.writeText(content);
      toast.success(successMessage);
    } catch {
      toast.error(fallbackMessage);
    }
  };

  const handleCopyMessage = async (content: string) => {
    await writeClipboardText(content, "内容已复制", "当前环境暂不支持复制，请手动选择内容");
  };

  const handleShareMessage = async (content: string) => {
    await writeClipboardText(content, "已复制分享内容", "当前环境暂不支持分享复制，请手动复制内容");
  };

  const handleToggleReaction = (messageId: string, reaction: "like" | "dislike") => {
    setMessageReactions((prev) => {
      const current = prev[messageId] ?? {};
      const nextValue = !current[reaction];
      return {
        ...prev,
        [messageId]: {
          like: reaction === "like" ? nextValue : false,
          dislike: reaction === "dislike" ? nextValue : false,
        },
      };
    });
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!activeConversation) return;
    const nextMessages = activeConversation.messages.filter((message) => message.id !== messageId);
    if (nextMessages.length === 0) {
      toast.error("当前会话至少保留一条消息");
      return;
    }

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              updatedAt: nowDateTime(),
              summary: nextMessages[nextMessages.length - 1]?.content.slice(0, 28) ?? conversation.summary,
              messages: nextMessages,
            }
          : conversation,
      ),
    );
    toast.success("消息已删除");
  };

  const handleRefreshMessage = (messageId: string) => {
    if (!activeConversation || isTyping) return;
    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId);
    if (messageIndex <= 0) return;

    const previousUserMessage = [...activeConversation.messages.slice(0, messageIndex)]
      .reverse()
      .find((message) => message.role === "user");

    if (!previousUserMessage) {
      toast.error("没有找到上一条用户问题");
      return;
    }

    setIsTyping(true);
    window.setTimeout(() => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === activeConversation.id
            ? {
                ...conversation,
                updatedAt: nowDateTime(),
                summary: previousUserMessage.content.slice(0, 28),
                messages: conversation.messages.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        content: `${makeAssistantReply(previousUserMessage.content)}\n\n[重新回答 ${nowTime()}]`,
                        time: nowTime(),
                      }
                    : message,
                ),
              }
            : conversation,
        ),
      );
      setIsTyping(false);
      toast.success("已重新生成回答");
    }, 700);
  };

  const handleBubblePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragStartRef.current = {
      x: bubblePosition.x,
      y: bubblePosition.y,
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    movedDuringDragRef.current = false;
    setDragging(true);
  };

  const handleBubbleClick = () => {
    if (movedDuringDragRef.current) {
      movedDuringDragRef.current = false;
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={bubbleRef}
        type="button"
        title="打开 MateChat"
        onPointerDown={handleBubblePointerDown}
        onClick={handleBubbleClick}
        style={{ left: bubblePosition.x, top: bubblePosition.y }}
        className={cn(
          "fixed z-50 flex items-center gap-3 rounded-full border border-white/70 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.32),transparent_42%),linear-gradient(135deg,#2f80ed_0%,#2563eb_45%,#0f9fb3_100%)] px-4 py-3 text-white shadow-[0_18px_38px_rgba(37,99,235,0.28)] transition-all duration-200",
          dragging ? "cursor-grabbing select-none scale-[1.03] shadow-[0_24px_48px_rgba(37,99,235,0.34)]" : "cursor-grab hover:-translate-y-1 hover:scale-[1.02]",
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

      {renderDialog ? (
        <div
          className={`fixed inset-0 z-[80] transition-all duration-300 ease-out ${
            animateVisible ? "bg-slate-950/24 backdrop-blur-[2px]" : "bg-slate-950/0 backdrop-blur-[0px]"
          }`}
          onClick={() => setOpen(false)}
        >
          <div
            className={`absolute inset-y-4 right-4 flex h-[calc(100vh-32px)] w-[min(1120px,calc(100vw-32px),50vw)] max-w-[calc(100vw-32px)] overflow-hidden rounded-[32px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,250,255,0.95))] shadow-[0_30px_80px_rgba(15,23,42,0.26)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              animateVisible ? "translate-x-0 scale-100 opacity-100" : "translate-x-8 scale-[0.98] opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="MateChat"
          >
            <section className="flex w-[30%] min-w-[260px] flex-col border-r border-slate-200/70 bg-[linear-gradient(180deg,#f6f9ff_0%,#eef5fd_100%)]">
              <div className="border-b border-slate-200/70 px-5 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">MateChat</div>
                    <h3 className="mt-1 text-slate-900">对话历史</h3>
                  </div>
                  <button type="button" onClick={createConversation} className="material-button-primary px-3 py-2 text-xs">
                    <MessageSquarePlus className="h-4 w-4" />
                    新建
                  </button>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索聊天内容"
                    className="material-input pl-11"
                  />
                </div>
              </div>

              <div className="material-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {filteredConversations.map((conversation) => {
                  const isActive = conversation.id === activeConversation?.id;
                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => setActiveId(conversation.id)}
                      className={`w-full rounded-[24px] border p-4 text-left transition ${
                        isActive
                          ? "border-blue-100 bg-[linear-gradient(135deg,#edf4ff_0%,#e8f4ff_72%,#eefaf8_100%)] shadow-[0_16px_30px_rgba(25,118,210,0.12)]"
                          : "border-slate-200/80 bg-white/82 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-semibold text-slate-900">{conversation.title}</div>
                        {conversation.pinned ? <Pin className="h-4 w-4 text-blue-600" /> : null}
                      </div>
                      <div className="line-clamp-2 text-sm leading-6 text-slate-600">{conversation.summary}</div>
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                        <Clock3 className="h-3.5 w-3.5" />
                        {conversation.updatedAt}
                      </div>
                    </button>
                  );
                })}

                {filteredConversations.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center text-sm text-slate-500">
                    没找到匹配的会话，试试新建一个问题。
                  </div>
                ) : null}
              </div>
            </section>

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-5">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Conversation</div>
                  <h2 className="mt-1 truncate text-[1.35rem] text-slate-900">{activeConversation?.title ?? "MateChat"}</h2>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  <button type="button" onClick={togglePin} className="material-button-secondary px-3 py-2 text-xs">
                    <Pin className="h-4 w-4" />
                    {activeConversation?.pinned ? "取消置顶" : "置顶"}
                  </button>
                  <button type="button" onClick={startRename} className="material-button-secondary px-3 py-2 text-xs">
                    <PencilLine className="h-4 w-4" />
                    重命名
                  </button>
                  <button type="button" onClick={removeConversation} className="material-button-secondary px-3 py-2 text-xs text-red-500">
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {isRenaming ? (
                <div className="border-b border-slate-200/70 bg-slate-50/70 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <input
                      value={renameTitle}
                      onChange={(event) => setRenameTitle(event.target.value)}
                      className="material-input"
                      placeholder="输入新的会话标题"
                    />
                    <button type="button" onClick={confirmRename} className="material-button-primary">
                      保存
                    </button>
                    <button type="button" onClick={() => setIsRenaming(false)} className="material-button-secondary">
                      取消
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="material-scrollbar flex-1 space-y-5 overflow-y-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f4f8fd_100%)] px-6 py-6">
                {activeConversation?.messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`flex max-w-[82%] gap-3 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                      {message.role === "user" ? (
                        <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#f59e90_0%,#f6c56b_58%,#a3c94c_100%)] text-sm font-semibold text-white shadow-sm">
                          {user?.name?.slice(0, 1) ?? "U"}
                        </div>
                      ) : (
                        <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center">
                          <img src={AI_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />
                        </div>
                      )}
                      <div className={message.role === "user" ? "text-right" : ""}>
                        <div
                          className={`rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm ${
                            message.role === "user"
                              ? "rounded-tr-md bg-[#f5f5fb] text-slate-800"
                              : "rounded-tl-md bg-[#f5f5fb] text-slate-800"
                          }`}
                        >
                          {message.content}
                        </div>
                        <div className="mt-1 px-1 text-xs text-slate-400">{message.time}</div>
                        {message.role === "assistant" ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                            {([
                              {
                                key: "copy",
                                icon: Copy,
                                label: "复制",
                                onClick: () => handleCopyMessage(message.content),
                                isActive: false,
                              },
                              {
                                key: "refresh",
                                icon: RefreshCw,
                                label: "重新回答",
                                onClick: () => handleRefreshMessage(message.id),
                                isActive: false,
                              },
                              {
                                key: "like",
                                icon: ThumbsUp,
                                label: "点赞",
                                onClick: () => handleToggleReaction(message.id, "like"),
                                isActive: messageReactions[message.id]?.like ?? false,
                              },
                              {
                                key: "dislike",
                                icon: ThumbsDown,
                                label: "点踩",
                                onClick: () => handleToggleReaction(message.id, "dislike"),
                                isActive: messageReactions[message.id]?.dislike ?? false,
                              },
                              {
                                key: "delete",
                                icon: Trash2,
                                label: "删除",
                                onClick: () => handleDeleteMessage(message.id),
                                isActive: false,
                              },
                              {
                                key: "share",
                                icon: Share2,
                                label: "分享",
                                onClick: () => handleShareMessage(message.content),
                                isActive: false,
                              },
                            ] satisfies ToolbarAction[]).map((action) => {
                              const Icon = action.icon;
                              return (
                                <button
                                  key={action.key}
                                  type="button"
                                  onClick={action.onClick}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
                                    action.isActive
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  {action.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

                {isTyping ? (
                  <div className="flex">
                    <div className="flex max-w-[82%] gap-3">
                      <div className="mt-1 flex h-10 w-10 items-center justify-center">
                        <img src={AI_AVATAR} alt="MateChat" className="h-8 w-8 object-contain" />
                      </div>
                      <div className="rounded-[24px] rounded-tl-md bg-[#f5f5fb] px-4 py-4 shadow-sm">
                        <div className="flex items-center gap-3">
                          {[0, 1, 2].map((index) => (
                            <span
                              key={index}
                              className="h-3 w-3 rounded-full bg-[#c5b4ff] animate-pulse"
                              style={{ animationDelay: `${index * 150}ms` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-slate-200/70 bg-white px-6 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      className="rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50/92 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
                  <textarea
                    rows={3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    className="material-scrollbar min-h-[88px] w-full resize-none bg-transparent text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400"
                    placeholder="输入你的问题，MateChat 会在当前会话里持续整理。Enter 发送，Shift + Enter 换行。"
                  />
                  <div className="mt-3 flex items-center justify-between gap-4">
                    <div className="text-xs text-slate-400">支持新建对话、历史搜索、重命名、置顶和持续追问。</div>
                    <button type="button" onClick={() => handleSend()} className="material-button-primary">
                      <Send className="h-4 w-4" />
                      发送
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}



