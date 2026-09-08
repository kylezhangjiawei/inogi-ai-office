import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const mateChat = source("src/app/components/MateChatBubble.tsx");
const citations = source("src/app/components/RagCitations.tsx");
const streakCard = source("src/app/components/matechat/MateChatStreakCard.tsx");
const reminderModal = source("src/app/components/matechat/MateChatReminderModal.tsx");
const visualSources = {
  "MateChat 助手": mateChat,
  "RAG 引用": citations,
  "MateChat 连胜卡片": streakCard,
  "MateChat 使用提醒": reminderModal,
};

test("MateChat 与 RAG 引用接入 Horizon/Klein Blue 初步视觉", () => {
  assert.match(mateChat, /className="horizon-theme matechat-horizon/);
  assert.match(citations, /className="rag-horizon-citations/);
  assert.match(mateChat, /bg-\[#002fa7\]/);
  assert.match(mateChat, /bg-\[#eef3ff\]/);
  assert.match(citations, /text-\[#002fa7\]/);
  assert.match(streakCard, /matechat-streak-horizon/);
  assert.match(reminderModal, /matechat-reminder-horizon/);
  assert.match(streakCard, /bg-\[#002fa7\]/);
  assert.match(reminderModal, /bg-\[#002fa7\]/);

  for (const [name, implementation] of Object.entries(visualSources)) {
    assert.doesNotMatch(implementation, /\b(?:indigo|violet|purple|fuchsia|pink)-/i, `${name}不应包含旧紫色强调`);
    assert.doesNotMatch(implementation, /\bdark:/, `${name}应保持浅色工作台`);
    assert.doesNotMatch(implementation, /bg-gradient|linear-gradient|radial-gradient/i, `${name}不应使用渐变`);
    assert.doesNotMatch(implementation, /\btracking-/, `${name}不应修改字距`);
    assert.doesNotMatch(implementation, /\btransition-all\b/, `${name}不应使用全属性过渡`);
    assert.doesNotMatch(implementation, /hover:-translate/, `${name}不应使用悬停位移`);
  }
});

test("全局使用提醒使用 Dialog，并保留时段、账号、路由与稍后提醒契约", () => {
  assert.match(reminderModal, /<Dialog open=\{open && Boolean\(data\)\}/);
  assert.match(reminderModal, /<DialogContent/);
  assert.match(reminderModal, /<DialogTitle/);
  assert.match(reminderModal, /<DialogDescription/);
  assert.doesNotMatch(reminderModal, /role="dialog"|aria-modal="true"|fixed inset-0|window\.addEventListener\('keydown'/);

  assert.match(reminderModal, /function currentPeriod\(\): Period \| null/);
  assert.match(reminderModal, /storageKey\(user\.id, period\)/);
  assert.match(reminderModal, /localStorage\.getItem\(key\)/);
  assert.match(reminderModal, /localStorage\.setItem\(key, 'shown'\)/);
  assert.match(reminderModal, /chatStreakApi\.getMyStreak\(\)/);
  assert.match(reminderModal, /if \(streak\.todayDone\)/);
  assert.match(reminderModal, /isProcurementRoute/);
  assert.match(reminderModal, /matechatReminder'\) === 'preview'/);
  assert.match(reminderModal, /setTimeout\(\(\) => void maybeShow\(\), 3000\)/);
  assert.match(reminderModal, /setInterval\(\(\) => void maybeShow\(\), CHECK_INTERVAL\)/);
  assert.match(reminderModal, /document\.addEventListener\('visibilitychange', onVisible\)/);
  assert.match(reminderModal, /openMateChat\(\);[\s\S]*close\(\);/);
  assert.equal((reminderModal.match(/onClick=\{close\}/g) ?? []).length, 1, "应保留稍后再说入口");
});

test("连胜卡片保留 compact/full、加载、周记录、里程碑和聊天入口", () => {
  assert.match(streakCard, /variant\?: 'full' \| 'compact'/);
  assert.match(streakCard, /if \(variant === 'compact'\)/);
  assert.match(streakCard, /const streak = data\?\.currentStreak \?\? 0/);
  assert.match(streakCard, /data\.bestStreak/);
  assert.match(streakCard, /<WeekStrip weekActivity=\{data\?\.weekActivity/);
  assert.match(streakCard, /todayDone=\{data\?\.todayDone \?\? false\}/);
  assert.match(streakCard, /<CardBackground url=\{data\?\.mascotUrl \?\? null\}/);
  assert.match(streakCard, /data\?\.milestone && <Confetti/);
  assert.match(streakCard, /loading \? <span/);
  assert.match(streakCard, /loading \|\| !data/);
  assert.match(streakCard, /const goChat = onGoChat \?\? openMateChat/);
  assert.equal((streakCard.match(/onClick=\{goChat\}/g) ?? []).length, 2);
  assert.match(streakCard, /text-pretty/);
  assert.match(streakCard, /tabular-nums/);
});

test("聊天窗口、分享、删除、图片预览与模型选择使用项目可访问原语", () => {
  assert.match(mateChat, /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(mateChat, /<SheetContent/);
  assert.match(mateChat, /<SheetTitle/);
  assert.match(mateChat, /<SheetDescription/);
  assert.match(mateChat, /<Dialog open=\{Boolean\(shareTarget\)\}/);
  assert.equal((mateChat.match(/<AlertDialog\b/g) ?? []).length, 2);
  assert.match(mateChat, /<DropdownMenu open=\{showModelMenu/);
  assert.match(mateChat, /<DropdownMenuRadioGroup value=\{selectedModel\}/);
  assert.match(citations, /<Dialog open=\{Boolean\(lightbox\)\}/);
  assert.doesNotMatch(mateChat, /role="dialog"|aria-modal="true"|fixed inset-0/);
  assert.doesNotMatch(citations, /createPortal|role="dialog"|aria-modal="true"|fixed inset-0/);
});

test("MateChat 保留聊天、流式消息、引用、附件、分享与全局唤起业务契约", () => {
  assert.match(mateChat, /window\.addEventListener\(MATECHAT_OPEN_EVENT, openChat\)/);
  assert.match(mateChat, /notifyMateChatActivity\(\)/);
  assert.match(mateChat, /apiListConversations\(\)/);
  assert.match(mateChat, /apiGetMessages\(convId\)/);
  assert.match(mateChat, /apiCreateConversation\(\)/);
  assert.match(mateChat, /apiRecordUsageEvent\(/);
  // 分享交给服务端按已保存消息及资源权限校验，客户端不再直接转发正文。
  assert.match(mateChat, /workspaceRequest\(`messages\/\$\{encodeURIComponent\(shareTarget\.id\)\}\/share`/);
  assert.match(mateChat, /authFetch\("\/api\/chat\/share-recipients"\)/);
  assert.match(mateChat, /event\.type === "delta"/);
  assert.match(mateChat, /event\.type === "citations"/);
  assert.match(mateChat, /event\.type === "tool_step"/);
  assert.match(mateChat, /uploadResourceFile\(/);
  assert.match(mateChat, /compressImageFile\(/);
  assert.match(mateChat, /<RagCitations citations=\{msgCitations\[msg\.id\]\.citations\}/);
  assert.match(mateChat, /onDragEnter=\{onDragEnter\}/);
  assert.match(mateChat, /onPaste=\{onPasteInput\}/);
  assert.match(mateChat, /abortRef\.current\?\.abort\(\)/);
});

test("公共助手排版、数据与图标按钮满足 baseline 约束", () => {
  assert.match(mateChat, /text-balance/);
  assert.match(mateChat, /text-pretty/);
  assert.match(mateChat, /tabular-nums/);
  assert.match(mateChat, /aria-label="打开 MateChat 助手"/);
  assert.match(mateChat, /aria-label="关闭 MateChat"/);
  assert.match(mateChat, /aria-label="添加附件"/);
  assert.match(mateChat, /aria-label=\{`移除附件：\$\{a\.name\}`\}/);
  assert.match(citations, /aria-label=\{`预览图片：/);
  assert.match(citations, /aria-label=\{`查看原文：/);
  assert.match(citations, /aria-label=\{`下载原文件：/);
  assert.match(citations, /tabular-nums/);
});
