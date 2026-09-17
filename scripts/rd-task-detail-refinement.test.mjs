import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const files = {
  detail: await read("src/app/RDTaskDetailPage.tsx"),
  conversation: await read("src/app/RDTaskConversation.tsx"),
  evidence: await read("src/app/RDProgressEvidence.tsx"),
  reports: await read("src/app/RDReportsPanel.tsx"),
};
const management = await read("src/app/RDTaskManagementPage.tsx");

test("任务详情链路保持 Horizon / Horizon 主题，并移除旧装饰与手写模态层", () => {
  const forbidden = /gradient|backdrop-blur|\b(?:purple|violet|indigo|fuchsia|pink)-|\btracking-|transition-all|hover:-translate|group-hover:translate|createPortal|<[^>]*\srole="dialog"/i;
  for (const [name, source] of Object.entries(files)) {
    assert.doesNotMatch(source, forbidden, `${name} 不应保留旧装饰或手写模态层`);
  }
  assert.match(files.detail, /RD_TASK_DETAIL_HORIZON_SCOPE/);
  assert.match(files.detail, /bg-primary/);
  assert.match(files.conversation, /bg-primary/);
  assert.match(files.reports, /data-\[state=active\]:bg-primary/);
});

test("详情页提供事实摘要、结构化首屏与可恢复的进展和附件状态", () => {
  assert.doesNotMatch(files.detail, /<h1/, "页面壳已提供唯一主标题，详情内容区不应重复 h1");
  assert.match(files.detail, /aria-label=\{t\("任务事实摘要"\)\}/);
  assert.match(files.detail, /completedWorkItemCount/);
  assert.match(files.detail, /attachmentCount/);
  assert.match(files.detail, /role="status"[\s\S]*aria-label=\{t\("正在加载任务详情"\)\}/);
  assert.match(files.detail, /role="alert"[\s\S]*t\("任务详情暂不可用"\)/);
  assert.match(files.detail, /const \[notesError, setNotesError\] = useState\(""\)/);
  assert.match(files.detail, /notesError=\{notesError\}/);
  assert.match(files.detail, /onRetryNotes=\{\(\) => void loadProgressGroup\(\)\}/);
  assert.match(files.detail, /t\("附件库暂不可用"\)/);
  assert.match(files.detail, /<h2 className="[^"]*text-balance[^"]*break-words/);
  assert.doesNotMatch(files.detail, /<h2 className="[^"]*line-clamp-/);
  assert.match(files.detail, /whitespace-pre-wrap break-words text-pretty/);
});

test("任务操作使用 Radix Dialog，并在提交位置展示错误与进行中反馈", () => {
  assert.match(files.detail, /DialogContent, DialogDescription, DialogHeader, DialogTitle/);
  assert.equal((files.detail.match(/<Dialog open onOpenChange=/g) ?? []).length, 4);
  assert.ok((files.detail.match(/role="alert"/g) ?? []).length >= 5);
  assert.ok((files.detail.match(/const \[submitError, setSubmitError\]/g) ?? []).length >= 4);
  for (const label of ["保存中…", "创建中…", "并入中…", "取消中…"]) {
    assert.match(files.detail, new RegExp(label));
  }
  assert.match(files.detail, /aria-pressed=\{checked\}/);
  assert.match(files.detail, /onEscapeKeyDown=\{\(event\) => \{ if \(saving\) event\.preventDefault\(\); \}\}/);
});

test("讨论主链路与线程请求防止旧响应覆盖，并提供就地发送错误和恢复入口", () => {
  assert.match(files.conversation, /const mainLoadSeqRef = useRef\(0\)/);
  assert.match(files.conversation, /const threadLoadSeqRef = useRef\(0\)/);
  assert.match(files.conversation, /if \(seq !== mainLoadSeqRef\.current[\s\S]{0,240}\) return/);
  assert.match(files.conversation, /if \(seq !== threadLoadSeqRef\.current[\s\S]{0,320}\) return/);
  assert.match(files.conversation, /activeWorkspaceKeyRef\.current !== expectedWorkspaceKey/);
  assert.match(files.conversation, /const pageSeq = \+\+mainPageSeqRef\.current/);
  assert.match(files.conversation, /const pageSeq = \+\+threadPageSeqRef\.current/);
  assert.match(files.conversation, /current\.thread\.id !== response\.thread\.id/);
  assert.match(files.conversation, /sendRequestRef\.current/);
  assert.match(files.conversation, /const \[mainError, setMainError\] = useState\(""\)/);
  assert.match(files.conversation, /const \[threadError, setThreadError\] = useState\(""\)/);
  assert.match(files.conversation, /t\("重新加载讨论"\)/);
  assert.match(files.conversation, /t\("重新加载线程"\)/);
  assert.match(files.conversation, /const \[submitError, setSubmitError\] = useState\(""\)/);
  assert.match(files.conversation, /aria-busy=\{sending\}/);
  assert.match(files.conversation, /role="alert">[\s\S]*\{submitError\}/);
});

test("详情任务与进展刷新同时绑定当前路由任务，旧操作不能覆盖新页面", () => {
  assert.match(files.detail, /const activeTaskIdRef = useRef\(taskId\)/);
  assert.match(files.detail, /activeTaskIdRef\.current = taskId/);
  assert.match(files.detail, /expectedTaskId = opts\?\.expectedTaskId \?\? taskId/);
  assert.ok(
    (files.detail.match(/activeTaskIdRef\.current !== expectedTaskId/g) ?? []).length >= 6,
    "任务与进展请求的开始、成功和失败路径都应核对当前路由任务",
  );
  assert.match(files.detail, /all\.find\(\(t\) => t\.task_id === expectedTaskId\)/);
  assert.match(files.detail, /fetchRdTaskProgressNoteGroup\(expectedTaskId\)/);
  assert.match(files.detail, /markRdTaskNotesRead\(expectedTaskId\)/);
  assert.match(files.detail, /key=\{`transfer-procurement-\$\{task\.task_id\}`\}/);
  assert.match(files.detail, /onTransferred=\{\(nextProcTask\) => \{[\s\S]{0,120}activeTaskIdRef\.current !== task\.task_id[\s\S]{0,120}setProcTask\(nextProcTask\)/);
  assert.match(files.detail, /onClose=\{\(\) => \{[\s\S]{0,120}activeTaskIdRef\.current !== task\.task_id[\s\S]{0,120}setTransferOpen\(false\)/);
});

test("长讨论和附件具备可读排版、可访问预览及表格失败重试", () => {
  assert.match(files.conversation, /whitespace-pre-wrap break-words text-pretty text-sm/);
  assert.match(files.evidence, /<Dialog open onOpenChange=/);
  assert.equal((files.evidence.match(/<Dialog open onOpenChange=/g) ?? []).length, 2);
  assert.match(files.evidence, /<DialogTitle className="sr-only">/);
  assert.match(files.evidence, /h-dvh/);
  assert.match(files.evidence, /const \[retryKey, setRetryKey\] = useState\(0\)/);
  assert.match(files.evidence, /setRetryKey\(\(current\) => current \+ 1\)/);
  assert.match(files.evidence, /role="status" aria-label="正在解析表格"/);
  assert.match(files.evidence, /text-balance/);
  assert.match(files.evidence, /text-pretty/);
  assert.match(files.evidence, /tabular-nums/);
});

test("报告周期在窄屏可用且保留日报、月报和原有 Props 契约", () => {
  assert.match(files.reports, /t\("研发工作报告"\)/);
  assert.match(files.reports, /text-balance/);
  assert.match(files.reports, /text-pretty/);
  assert.match(files.reports, /w-full shrink-0 sm:w-fit/);
  assert.match(files.reports, /flex-1[\s\S]*sm:flex-none/);
  assert.match(files.reports, /aria-live="polite"/);
  assert.match(files.reports, /<RDDailyReportPanel canRegenerate=\{canRegenerate\} tabSlot=\{tabBar\} spacious=\{spacious\} onDailyReportsLoaded=\{onDailyReportsLoaded\} \/>/);
  assert.match(files.reports, /<RDMonthlyReportPanel canRegenerate=\{canRegenerate\} tabSlot=\{tabBar\} spacious=\{spacious\} \/>/);
});

test("任务、合并、成员范围、工作区、讨论与附件业务契约保持可达", () => {
  for (const contract of [
    "fetchMergedTaskCategories()",
    "buildSubtaskParentIndex(categories)",
    "fetchRdTaskProgressNoteGroup(expectedTaskId)",
    "attachRdTasksToParent(childIds, expectedTaskId)",
    "detachRdSubtasks(childIds, expectedTaskId)",
    "isProductionWorkspace()",
    "updateRdTask(expectedTaskId",
    "useProcurementTaskLink(taskId)",
  ]) assert.ok(files.detail.includes(contract), `详情业务契约缺失：${contract}`);
  assert.match(files.detail, /const expectedTaskId = task\.task_id;[\s\S]*if \(activeTaskIdRef\.current !== expectedTaskId\) return;/);

  for (const contract of [
    "fetchRdTaskDiscussion(taskId",
    "createRdTaskDiscussionMessage({",
    "markRdTaskDiscussionRead",
    "reply_to_id: replyTarget?.id",
    "mentions: mention.mentionsForSubmit(text)",
    "files,",
  ]) assert.ok(files.conversation.includes(contract), `讨论业务契约缺失：${contract}`);

  assert.match(files.conversation, /isUsCollabWorkspace\(\) \? "us-collab" : "rd"/);

  for (const contract of [
    "getAttachmentDownloadUrl",
    "getAttachmentPreviewUrl",
    "getAttachmentThumbUrl",
    "parseXlsxForPreview",
    "pinchTaskImageTransform",
  ]) assert.ok(files.evidence.includes(contract), `附件业务契约缺失：${contract}`);
});

test("核心任务动作统一由 Radix Dialog 管理焦点与 Escape", () => {
  assert.match(management, /function TaskActionDialogFrame/);
  assert.match(management, /<Dialog open onOpenChange=/);
  assert.match(management, /<DialogContent[\s\S]{0,260}onEscapeKeyDown=/);
  for (const component of ["SubmitConfirmDialog", "CompleteConfirmDialog", "HandoverDialog", "AddCollaboratorsDialog", "ApprovalActionDialog"]) {
    const start = management.indexOf(`function ${component}`);
    const next = management.indexOf("\nexport function ", start + 1);
    const scope = management.slice(start, next > start ? next : undefined);
    assert.ok(start >= 0, `缺少 ${component}`);
    assert.match(scope, /<TaskActionDialogFrame/);
    assert.doesNotMatch(scope, /fixed inset-0[^\n]+onClick=\{onCancel\}/);
  }
});

test("窄屏讨论线程具备对话框语义、背景隔离、焦点约束与 Escape 关闭", () => {
  assert.match(files.conversation, /role=\{threadIsOverlay \? "dialog" : undefined\}/);
  assert.match(files.conversation, /aria-modal=\{threadIsOverlay \? true : undefined\}/);
  assert.match(files.conversation, /mainElement\.setAttribute\("inert", ""\)/);
  assert.match(files.conversation, /event\.key === "Escape"[\s\S]{0,120}closeThread\(\)/);
  assert.match(files.conversation, /threadBackButtonRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(files.conversation, /ref=\{threadBackButtonRef\}[\s\S]{0,120}tabIndex=\{-1\}/);
});

test("大列表派生查找使用 Map / Set，避免时间线和讨论摘要重复线性扫描", () => {
  assert.match(files.detail, /const reportLogById = useMemo\(\(\) => new Map/);
  assert.match(files.detail, /const progressGroupTaskIds = useMemo\([\s\S]*new Set/);
  assert.match(files.conversation, /const threadSummaryByAnchor = useMemo\([\s\S]*new Map/);
  assert.match(files.conversation, /const candidates = useMemo\([\s\S]*new Map/);
  assert.doesNotMatch(files.detail, /reportLogs\.find\(/);
});
