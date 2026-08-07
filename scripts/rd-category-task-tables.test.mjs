import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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
