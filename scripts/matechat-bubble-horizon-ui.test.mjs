import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

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

const mateAst = ts.createSourceFile('MateChatBubble.tsx', mateChat, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function conversationFunction(name, scope) {
  let expression;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(mateAst);
    if (ts.isVariableDeclaration(node) && node.name.getText(mateAst) === name) expression = node.initializer.getText(mateAst);
    ts.forEachChild(node, visit);
  }
  visit(mateAst);
  assert.ok(expression, `missing ${name}`);
  const code = ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

test('聊天更新对话按权限、会话失效、缺失、校验和网络故障显示中文', async () => {
  for (const [status, body, message] of [
    [401, { message: 'Unauthorized' }, '登录已失效，请重新登录后再试'],
    [403, { message: 'Forbidden' }, '没有修改该对话的权限'],
    [404, { message: 'Not Found' }, '对话不存在或已被删除，请刷新列表后重试'],
    [429, { message: 'Too Many Requests' }, '操作过于频繁，请稍后再试'],
    [500, { message: '服务器内部细节' }, '服务器暂时无法更新对话，请稍后重试'],
    [400, { message: ['标题不能超过 200 个字符'] }, '标题不能超过 200 个字符'],
    [400, { message: 'Error' }, '更新对话失败，请检查输入后重试'],
  ]) {
    const update = conversationFunction('apiUpdateConversation', { authFetch: async () => Response.json(body, { status }) });
    await assert.rejects(() => update('A', { title: '新标题' }), { message });
  }
  const offline = conversationFunction('apiUpdateConversation', { authFetch: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(() => offline('A', { pinned: true }), { message: '网络连接异常，请检查网络后重试' });
});

for (const action of ['togglePin', 'confirmRename']) {
  test(`${action} 失败显示提示并保留标题/置顶状态，重试成功后才更新`, async () => {
    let fail = true;
    const activeConv = { id: 'A', title: '原标题', pinned: false };
    const values = { conversations: [activeConv], saving: false, renaming: true, messages: [] };
    const update = conversationFunction('apiUpdateConversation', { authFetch: async () => fail
      ? Response.json({ message: 'Forbidden' }, { status: 403 })
      : Response.json({ ...activeConv, title: '新标题', pinned: true }) });
    const scope = {
      activeConv, renameTitle: '新标题', conversationSavingRef: { current: false },
      apiUpdateConversation: update,
      setConversationSaving: (value) => { values.saving = value; },
      setConversations: (update) => { values.conversations = update(values.conversations); },
      setIsRenaming: (value) => { values.renaming = value; },
      toast: { error: (message) => values.messages.push(['error', message]), success: (message) => values.messages.push(['success', message]) },
    };
    const run = conversationFunction(action, scope);
    await run();
    assert.deepEqual(values.conversations, [activeConv]);
    assert.equal(scope.renameTitle, '新标题');
    assert.equal(values.renaming, true);
    assert.equal(values.saving, false);
    assert.equal(scope.conversationSavingRef.current, false);
    assert.deepEqual(values.messages, [['error', '没有修改该对话的权限']]);
    fail = false;
    await run();
    assert.equal(values.conversations[0][action === 'togglePin' ? 'pinned' : 'title'], action === 'togglePin' ? true : '新标题');
    assert.equal(values.messages[1][0], 'success');
    if (action === 'confirmRename') assert.equal(values.renaming, false);
  });
}

test('聊天置顶和重命名在请求期间禁止重复提交，失败后释放操作', async () => {
  let reject;
  const pending = new Promise((_resolve, rejectRequest) => { reject = rejectRequest; });
  let calls = 0;
  let saving = false;
  const scope = {
    activeConv: { id: 'A', title: '原标题', pinned: false }, renameTitle: '新标题',
    conversationSavingRef: { current: false },
    apiUpdateConversation: () => { calls++; return pending; },
    setConversationSaving: (value) => { saving = value; },
    setConversations: assert.fail, setIsRenaming: assert.fail,
    toast: { error() {}, success: assert.fail },
  };
  const first = conversationFunction('togglePin', scope)();
  assert.equal(saving, true);
  await conversationFunction('togglePin', scope)();
  await conversationFunction('confirmRename', scope)();
  assert.equal(calls, 1);
  reject(new Error('连接失败'));
  await first;
  assert.equal(saving, false);
  assert.equal(scope.conversationSavingRef.current, false);
});

test("MateChat 与 RAG 引用接入 Horizon 语义主题", () => {
  assert.match(mateChat, /className="horizon-theme matechat-horizon/);
  assert.match(citations, /className="rag-horizon-citations/);
  assert.match(mateChat, /bg-primary/);
  assert.match(mateChat, /bg-accent/);
  assert.match(citations, /text-primary/);
  assert.match(streakCard, /matechat-streak-horizon/);
  assert.match(reminderModal, /matechat-reminder-horizon/);
  assert.match(streakCard, /bg-primary/);
  assert.match(reminderModal, /bg-primary/);

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
