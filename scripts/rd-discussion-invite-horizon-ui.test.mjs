import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/RDDiscussionInvitePage.tsx", import.meta.url),
  "utf8",
);
const conversationSource = readFileSync(
  new URL("../src/app/RDTaskConversation.tsx", import.meta.url),
  "utf8",
);

test("讨论邀请页统一使用 Horizon 外壳且不伪造指标", () => {
  assert.match(source, /"horizon-theme hz-page min-w-0"/);
  assert.match(source, /<HorizonPageHeader/);
  assert.match(source, /rd-horizon-module rd-horizon-discussion/);
  assert.doesNotMatch(source, /nativeRdDiscussion/);
  assert.equal((source.match(/<HorizonMetric\b/g) ?? []).length, 0);
  assert.match(source, /usCollab \? t\("中美协同 · 任务线程"\) : t\("研发协作 · 任务线程"\)/);
});

test("移动讨论保留独立紧凑外壳并处理安全区", () => {
  assert.match(source, /location\.pathname\.startsWith\("\/m\/"\)/);
  assert.match(source, /location\.pathname\.startsWith\("\/us-collab-m\/"\)/);
  assert.match(source, /pb-\[max\(0\.25rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source, /variant=\{mobile \? "mobile" : "desktop"\}/);
  assert.match(source, /<h1 className="truncate text-sm font-bold text-slate-900">\{title\}<\/h1>/);
});

test("讨论锚点与消息定位参数保持原有契约", () => {
  assert.match(source, /parseAnchorType\(searchParams\.get\("anchor_type"\)\)/);
  assert.match(source, /const anchorId = searchParams\.get\("anchor_id"\)/);
  assert.match(source, /const focusMessageId = searchParams\.get\("message_id"\)/);
  assert.match(source, /type: anchorType/);
  assert.match(source, /id: anchorId/);
  assert.match(source, /preview: searchParams\.get\("excerpt"\)/);
  assert.match(source, /focusAnchor=\{focusAnchor\}/);
  assert.match(source, /focusMessageId=\{focusMessageId\}/);
});

test("通知继续先标记已读、发言后标记已处理并广播更新", () => {
  assert.match(source, /syncNotification\("read"\)/);
  assert.match(source, /mode === "handled"[\s\S]{0,120}\{ handled: true, read: true \}/);
  assert.match(source, /patchRdMessage\(notificationId/);
  assert.match(source, /new CustomEvent\("rd:messages-updated"\)/);
  assert.match(source, /onMessageSent=\{markHandled\}/);
  assert.match(source, /if \(!notificationId \|\| handled\) return/);
});

test("缺失任务与通知同步失败均提供相邻状态和恢复入口", () => {
  assert.match(source, /!taskId \? \(/);
  assert.match(source, /<HorizonEmptyState/);
  assert.match(source, /当前链接缺少任务编号/);
  assert.match(source, /notificationError \? \(/);
  assert.ok((source.match(/role="alert"/g) ?? []).length >= 2);
  assert.match(source, /retryNotificationSync/);
  assert.match(source, /notificationRetrying \? t\("同步中"\) : t\("重试"\)/);
});

test("返回与线程替换语义覆盖桌面、协同和移动回退", () => {
  assert.match(source, /if \(window\.history\.length > 1\) navigate\(-1\)/);
  assert.match(source, /"\/us-collab-m" : "\/m"/);
  assert.match(source, /: "\/message-center"/);
  assert.match(source, /threadLayout="replace"/);
  assert.match(source, /showHeader=\{false\}/);
  assert.match(source, /onCloseFocus=\{close\}/);
});

test("页面使用 Klein Blue 且无旧装饰和手写模态层", () => {
  assert.match(source, /bg-\[#002fa7\]/);
  assert.doesNotMatch(source, /gradient|purple-|violet-|indigo-|tracking-|transition-all|hover:-translate/);
  assert.doesNotMatch(source, /createPortal|fixed inset-0|backdrop-blur/);
  assert.doesNotMatch(conversationSource, /gradient|purple-|violet-|indigo-|fuchsia-|pink-|tracking-/);
  assert.match(source, /focus-visible:ring-2/);
});

test("移动任务讨论统一 Klein Blue，输入区保持 44px 触控目标", () => {
  assert.match(conversationSource, /bg-\[#002fa7\]/);
  assert.match(conversationSource, /variant === "mobile" \? "size-11" : "size-9"/);
  assert.match(conversationSource, /variant === "mobile" \? "min-h-11 text-base" : "min-h-9 text-sm"/);
  assert.doesNotMatch(conversationSource, /rd-conversation-composer relative[^"\n]*backdrop-blur/);
});
