import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceSource = await readFile(
  new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url),
  "utf8",
);
const peopleSource = await readFile(
  new URL("../src/app/RDPeopleManagementPage.tsx", import.meta.url),
  "utf8",
);

test("研发工作台保留三工作区数据隔离并优化派生查询", () => {
  assert.match(workspaceSource, /fetchRdWorkspace\(\{ includeCollaboration: !isUsCollabWorkspace\(\) \}\)/);
  assert.match(workspaceSource, /const currentWorkspace = isUsCollabWorkspace\(\) \? "us-collab" : "rd";/);
  assert.match(workspaceSource, /const primaryTaskIds = useMemo\(\(\) => new Set/);
  assert.match(workspaceSource, /const deferredTaskKeyword = useDeferredValue\(taskKeyword\)/);
  assert.match(workspaceSource, /const taskById = useMemo\(\(\) => new Map/);
  assert.match(workspaceSource, /\[\.\.\.\(taskRoleTab === "primary" \? filteredMyTasks : filteredCollabTasks\)\]\.sort/);
  assert.doesNotMatch(
    workspaceSource,
    /\(taskRoleTab === "primary" \? filteredMyTasks : filteredCollabTasks\)\.sort/,
    "筛选结果不得被原地排序",
  );
});

test("研发工作台首屏使用文字、图标与可读数字呈现决策摘要", () => {
  assert.match(workspaceSource, /<h2 className="rd-horizon-workspace-title/);
  assert.doesNotMatch(workspaceSource, /<h1/, "页面壳已提供唯一主标题，工作台卡片不应重复 h1");
  for (const label of ["主责", "协助", "完成率", "逾期", "今日到期", "待处理"]) {
    assert.match(workspaceSource, new RegExp(`t\\(\"${label}\"\\)`));
  }
  for (const icon of ["User", "Users", "CheckCircle2", "AlertTriangle", "CalendarClock", "Bell"]) {
    assert.match(workspaceSource, new RegExp(`<${icon} className=\"size-3\"`));
  }
  assert.match(workspaceSource, /rd-horizon-workspace-metric[^\n]+tabular-nums/);
  assert.match(workspaceSource, /role="progressbar"[\s\S]{0,260}aria-valuenow=\{progressValue\}/);
  assert.match(workspaceSource, /text-balance text-\[15px\]/);
  assert.match(workspaceSource, /line-clamp-2 min-h-10 text-pretty/);
});

test("研发工作台搜索筛选、失败和空态都提供明确下一步", () => {
  assert.match(workspaceSource, /aria-label=\{t\("清除任务搜索"\)\}/);
  assert.match(workspaceSource, /t\("清空筛选"\)/);
  assert.match(workspaceSource, /role="alert"/);
  assert.match(workspaceSource, /onClick=\{\(\) => void loadWorkspace\(\)\}/);
  assert.match(workspaceSource, /t\("重新加载"\)/);
  assert.match(workspaceSource, /taskFiltersActive \? t\("清空筛选"\) : t\("刷新工作台"\)/);
  assert.match(workspaceSource, /role="status" aria-label=\{t\("正在加载任务"\)\}/);
  assert.match(workspaceSource, /focus-visible:ring-2 focus-visible:ring-primary/);
});

test("研发审核通知在任务已处理后独立收敛消息状态", () => {
  assert.match(workspaceSource, /const REVIEW_NOTIFICATION_PATCH_RETRY_DELAYS = \[0, 250, 750\] as const/);
  assert.match(workspaceSource, /function isReviewAlreadySettledError\(error: unknown\)/);
  assert.match(workspaceSource, /不是待审核状态\|不处于待审核状态\|没有待处理的审核\|请勿重复审核\|已被其他审核人处理/);
  assert.match(workspaceSource, /async function patchReviewNotificationHandled\(notificationId: string\): Promise<boolean>/);
  assert.match(workspaceSource, /retryReviewNotificationHandledLater\(notification\.id\)/);

  const settleStart = workspaceSource.indexOf("const settleReviewNotification");
  const settleEnd = workspaceSource.indexOf("const approveNotificationReview", settleStart);
  const settleSource = workspaceSource.slice(settleStart, settleEnd);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  assert.ok(
    settleSource.indexOf("setDismissedNotifs") < settleSource.indexOf("await patchReviewNotificationHandled"),
    "任务审核完成后应先撤掉本地操作入口，再等待通知回写",
  );
  assert.match(settleSource, /handled: true, read: true/);
  assert.match(settleSource, /current\?\.kind === "notification"/);

  assert.equal((workspaceSource.match(/if \(!isReviewAlreadySettledError\(error\)\) throw error;/g) ?? []).length, 2);
  assert.match(workspaceSource, /const messageSynced = await settleReviewNotification\(notification\)/);
  assert.match(workspaceSource, /if \(notif\) await rejectNotificationReview\(notif, reason\)/);
  assert.match(workspaceSource, /通知已从当前工作台收起，消息状态将在后台重试同步/);
});

test("审核确认提交期间锁住关闭路径，避免重复或相反动作并发", () => {
  const modalStart = workspaceSource.indexOf("function ConfirmActionModal");
  const modalEnd = workspaceSource.indexOf("function TaskCardUI", modalStart);
  const modalSource = workspaceSource.slice(modalStart, modalEnd);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  assert.match(modalSource, /const requestClose = \(\) => \{[\s\S]{0,80}if \(!confirming\) onCancel\(\)/);
  assert.match(modalSource, /useWorkspaceModalLayer\(surfaceRef, cancelButtonRef, requestClose\)/);
  assert.match(modalSource, /aria-busy=\{confirming\}/);
  assert.ok((modalSource.match(/disabled=\{confirming\}/g) ?? []).length >= 3);
  assert.match(modalSource, /onClick=\{requestClose\}/);
});

test("人员页复用真实任务负载并避免重复线性查找", () => {
  for (const field of ["task_count", "tasks", "blocked_count", "completed_this_month", "avg_completion"]) {
    assert.match(peopleSource, new RegExp(`${field}: person\\.${field}`));
  }
  assert.match(peopleSource, /const deferredKeyword = useDeferredValue\(keyword\.trim\(\)\.toLowerCase\(\)\)/);
  assert.match(peopleSource, /const userById = useMemo\(\(\) => new Map/);
  assert.match(peopleSource, /\(person\.task_count \?\? 0\) > person\.max_tasks/);
  assert.match(peopleSource, /t\("任务负载"\)/);
  assert.match(peopleSource, /role="progressbar"[\s\S]{0,260}aria-valuenow=\{loadPercentage\}/);
  assert.match(peopleSource, /t\("超负载"\)/);
  assert.match(peopleSource, /t\("暂无归属任务"\)/);
});

test("人员页具备响应式表格、语义表头与可恢复状态", () => {
  assert.match(peopleSource, /<h2 className="text-balance text-xl/);
  assert.doesNotMatch(peopleSource, /<h1/, "页面壳已提供唯一主标题，人员页内容区不应重复 h1");
  assert.match(peopleSource, /rd-people-table-scroll overflow-x-auto/);
  assert.match(peopleSource, /rd-people-table w-full min-w-\[1080px\]/);
  assert.equal((peopleSource.match(/<th scope="col"/g) ?? []).length, 9);
  assert.match(peopleSource, /colSpan=\{9\}/);
  assert.match(peopleSource, /role="alert"/);
  assert.match(peopleSource, /setReloadVersion\(\(version\) => version \+ 1\)/);
  assert.match(peopleSource, /t\("重新加载"\)/);
  assert.match(peopleSource, /t\("重置筛选"\)/);
  assert.match(peopleSource, /t\("刷新成员"\)/);
  assert.match(peopleSource, /text-balance text-xl/);
  assert.match(peopleSource, /text-pretty text-sm text-slate-500/);
});

test("人员新增、编辑、删除保留业务 API 并防止重复提交", () => {
  assert.match(peopleSource, /if \(savingPerson\) return;/);
  assert.match(peopleSource, /if \(deletingPerson\) return;/);
  assert.match(peopleSource, /if \(savingNewDept\) return;/);
  assert.match(peopleSource, /saving=\{savingPerson\}/);
  assert.match(peopleSource, /busy=\{deletingPerson\}/);
  assert.match(peopleSource, /aria-busy=\{saving\}/);
  assert.match(peopleSource, /aria-busy=\{busy\}/);
  assert.match(peopleSource, /updateRdPerson\(\{ \.\.\.personToMutation\(p\), id: editing\.id \}\)/);
  assert.match(peopleSource, /createRdPerson\(personToMutation\(p\)\)/);
  assert.match(peopleSource, /deleteRdPerson\(deleteTarget\.id\)/);
  assert.match(peopleSource, /role="alertdialog"/);
  assert.match(peopleSource, /createPortal\(dialog, document\.body\)/);
});

test("人员表单在身份与分组主数据不可验证时阻止保存并支持重试", () => {
  assert.match(peopleSource, /identityOptionsError/);
  assert.match(peopleSource, /departmentError/);
  assert.match(peopleSource, /const dependenciesReady = !identityOptionsError && !departmentError/);
  assert.match(peopleSource, /disabled=\{saving \|\| !dependenciesReady\}/);
  assert.match(peopleSource, /身份或分组主数据尚未读取成功/);
  assert.match(peopleSource, /aria-label=\{t\("知识库访问分值"\)\}/);
  assert.match(peopleSource, /aria-valuetext=/);
});

test("两页遵守 Horizon 基线视觉约束", () => {
  for (const [name, source] of [["工作台", workspaceSource], ["人员页", peopleSource]]) {
    assert.doesNotMatch(source, /\#[0-9a-f]{6}\][0-9]/i, `${name} 不应包含机械替色生成的非法任意值类名`);
    assert.doesNotMatch(source, /(?:indigo|violet|purple|pink|cyan|blue|red|orange)-\d+/i, `${name} 不应残留多强调色 token`);
    assert.doesNotMatch(source, /linear-gradient|backdrop-blur|transition-all|tracking-(?:tight|wide|wider|widest)/, `${name} 不应残留禁用视觉模式`);
    assert.doesNotMatch(source, /hover:-translate|group-hover:(?:-?translate|rotate)/, `${name} 不应使用 hover 位移动画`);
  }
});
