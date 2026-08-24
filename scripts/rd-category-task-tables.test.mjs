import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createServer } from "vite";

const workspacePage = await readFile(new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url), "utf8");
const cockpitPage = await readFile(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const apiClient = await readFile(new URL("../src/app/lib/rdApi.ts", import.meta.url), "utf8");
const controller = await readFile(
  new URL("../apps/api/src/modules/research-development/research-development.controller.ts", import.meta.url),
  "utf8",
);
const service = await readFile(
  new URL("../apps/api/src/modules/research-development/research-development.service.ts", import.meta.url),
  "utf8",
);

test("personal workspace renders flat task cards with primary and assist tabs", () => {
  assert.match(workspacePage, /useState<WorkspaceRoleTab>\("primary"\)/);
  assert.match(workspacePage, /role="tablist"/);
  assert.match(workspacePage, /setTaskRoleTab\("primary"\)/);
  assert.match(workspacePage, /setTaskRoleTab\("collaborator"\)/);
  assert.match(workspacePage, /taskRoleTab === "primary" \? filteredMyTasks : filteredCollabTasks/);
  assert.match(workspacePage, /const activeRoleTasks = useMemo/);
  assert.match(workspacePage, /<WorkspaceTaskCard/);
  assert.doesNotMatch(workspacePage, /taskViewRaw/);
});

test("personal workspace returns separate, de-duplicated primary and assist task sets", () => {
  assert.match(service, /const myTasks = visibleTasks\s*\.filter\(isPrimary\)/);
  assert.match(service, /const collabTasks = visibleTasks/);
  assert.match(service, /\.filter\(\(item\) => item\.role && !isPrimary\(item\.task\)\)/);
  assert.match(workspacePage, /primaryTaskIds\.has\(workspaceTaskIdentity\(task\)\)/);
  assert.match(workspacePage, /\{t\("协助"\)\} \{activeCollabCount\}/);
});

test("personal workspace task projection includes attachment counts for compact cards", () => {
  assert.match(apiClient, /attachments\?: number;/);
  assert.match(service, /attachments: typeof task\.attachments === 'number' \? Math\.max\(0, task\.attachments\) : 0/);
  assert.match(workspacePage, /attachmentPreview\?: RdTaskAttachmentPreview/);
  assert.match(workspacePage, /attachmentCount = attachmentPreview\?\.attachment_count \?\? task\.attachments \?\? 0/);
});

test("latest progress summary keeps the actor account for the compact card avatar", () => {
  assert.match(apiClient, /actor_user_id\?: string \| null;/);
  assert.match(service, /actor_user_id: cleanUserId\(value\.actor_user_id \?\? value\.actor_id \?\? actor\.user_id \?\? actor\.id\) \|\| null/);
});

test("category summary entry, view, and dedicated endpoint are removed", () => {
  assert.doesNotMatch(cockpitPage, /类目汇总表|category-summary|onOpenCategorySummary/);
  assert.doesNotMatch(apiClient, /fetchRdCategoryTaskTables|\/category-task-tables/);
  assert.doesNotMatch(controller, /categoryTaskTables|category-task-tables/);
  assert.doesNotMatch(service, /getCategoryTaskTables/);
});

test("administrator member projection is gated by task reassignment permission", () => {
  assert.match(cockpitPage, /const canViewCombinedMemberTasks = !usCollab && !productionWorkspace && canReassignTasks/);
  assert.match(controller, /@Get\('member-task-categories'\)[\s\S]*?@Permissions\('rd-task:reassign'\)/);
  assert.doesNotMatch(controller, /@Get\('member-task-categories'\)[\s\S]*?@Permissions\('rd-project:direct', 'rd-project:review-l2'\)/);
});

function exportTask(overrides) {
  return {
    task_id: "task-base",
    title: "测试任务",
    primary_owner: "刘至远",
    primary_owner_user_id: "rd-liu",
    status: "in_progress",
    archived: false,
    updated_at: "2026-08-07T08:00:00.000Z",
    collaborators: [],
    subtasks: [],
    ...overrides,
  };
}

async function loadExportModule(context) {
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  return server.ssrLoadModule("/src/app/lib/rdTaskExport.ts");
}

test("研发任务导出只允许当前驾驶舱配置人员的主责任务", async (context) => {
  const { filterRdTasksForExport } = await loadExportModule(context);
  const peopleDirectory = [
    { name: "刘至远", user_id: "rd-liu", status: "active" },
    { name: "李松", user_id: null, status: "active" },
    { name: "离职研发", user_id: "rd-left", status: "resigned" },
  ];
  const allTasks = [
    exportTask({ task_id: "configured-by-id" }),
    exportTask({ task_id: "configured-legacy-task-by-name", primary_owner_user_id: null }),
    exportTask({ task_id: "configured-legacy-name", primary_owner: "李松", primary_owner_user_id: null }),
    exportTask({ task_id: "same-name-wrong-id", primary_owner_user_id: "other-department-liu" }),
    exportTask({ task_id: "same-name-legacy-directory", primary_owner: "李松", primary_owner_user_id: "other-department-li" }),
    exportTask({
      task_id: "collab-outsider-zhu",
      primary_owner: "朱文枢",
      primary_owner_user_id: "collab-zhu",
      category_path: "协同任务 / 默认 / 研发任务",
    }),
    exportTask({
      task_id: "collab-outsider-zhang",
      primary_owner: "张佳伟",
      primary_owner_user_id: "collab-zhang",
      category_path: "协同任务 / 默认 / 研发任务",
    }),
    exportTask({ task_id: "unassigned", primary_owner: "待指派", primary_owner_user_id: null }),
    exportTask({ task_id: "resigned", primary_owner: "离职研发", primary_owner_user_id: "rd-left" }),
    exportTask({ task_id: "archived", archived: true }),
    exportTask({ task_id: "outside-range", updated_at: "2026-03-31T08:00:00.000Z" }),
  ];

  const exported = filterRdTasksForExport(
    allTasks,
    { start: "2026-04-01", end: "2026-08-07" },
    peopleDirectory,
  );

  assert.deepEqual(exported.map((item) => item.task_id), [
    "configured-by-id",
    "configured-legacy-task-by-name",
    "configured-legacy-name",
  ]);
});

test("研发人员目录未加载时导出失败关闭，不能回退为全量导出", async (context) => {
  const { filterRdTasksForExport } = await loadExportModule(context);

  assert.throws(
    () => filterRdTasksForExport(
      [exportTask({ task_id: "must-not-leak" })],
      { start: "2026-04-01", end: "2026-08-07" },
      [],
    ),
    /研发人员目录尚未加载/,
  );
});

test("个人工作台能并入/取消子任务：两个单任务接口都带工作台页面权限，越权由服务层兜底", () => {
  // 工作台确实调这两个接口；漏了页面权限普通研发点「确认并入」会吃 403
  assert.match(workspacePage, /attachRdTaskToParent\(task\.task_id, attachTargetId\)/);
  assert.match(workspacePage, /detachRdSubtask\(task\.task_id\)/);
  for (const route of ["tasks/:taskId/attach-parent", "tasks/:taskId/detach-parent"]) {
    const at = controller.indexOf(`@Post('task-categories/${route}')`);
    assert.ok(at > 0, `找不到路由：${route}`);
    const decorators = controller.slice(at, at + 600);
    assert.match(decorators, /@Permissions\([^)]*'page:rd-my-workspace'/, `${route} 缺少个人工作台权限`);
    assert.match(decorators, /@Permissions\([^)]*'page:us-collab-workspace'/, `${route} 缺少协同工作台权限`);
  }
  // 放宽守卫的前提：服务层对非管理员仍逐个校验参与关系，父任务与每个子任务都要过
  assert.match(service, /if \(!actor\.canEditAny\) \{[\s\S]{0,400}只能并入自己负责的任务/);
  assert.match(service, /if \(!actor\.canEditAny\) \{[\s\S]{0,400}只能操作自己负责的任务/);
});
