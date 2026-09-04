import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const proposal = readFileSync(new URL("../src/app/RDProjectProposalDialog.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");

// Execute the page's actual event handlers with API/UI effects supplied by the test.
function pageBindings(source, names, dependencies) {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      assert.ok(!declarations.has(node.name.text), `ambiguous binding ${node.name.text}`);
      declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(ast)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names) assert.ok(declarations.has(name), `missing binding ${name}`);
  const javascript = ts.transpileModule(
    names.map((name) => declarations.get(name)).join("\n") + `\nreturn { ${names.join(", ")} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return new Function(...Object.keys(dependencies), javascript)(...Object.values(dependencies));
}

function harness(area, overrides = {}) {
  const calls = { updates: [], confirms: [], errors: [], events: [], refreshes: 0, reviews: 0, creations: [] };
  const scope = {
    isUsCollabWorkspace: () => area === "us-collab",
    isProductionWorkspace: () => area === "production",
    canDirectProject: false,
    canSubmitProposal: true,
    canReviewProjectL1: false,
    canReviewProjectL2: false,
    canReassignTask: false,
    canManagePeople: false,
    userRole: "user",
    task: { task_id: "RD-1", status: "paused_blocked", due_date: "2026-09-03" },
    selectedCollaborators: [{ id: "member-2", name: "协作人" }],
    handoffReason: "增加协作人",
    draftDueDate: "2026-09-10",
    dueDateReason: "调整交付日期",
    abandonReason: "任务取消",
    t: (key) => key,
    toast: { success() {}, error: (message) => calls.errors.push(message) },
    onRequestConfirm: (config) => calls.confirms.push(config),
    updateRdTask: async (id, payload) => calls.updates.push({ id, payload }),
    onCollaborationChanged() {},
    onTaskChanged: () => calls.refreshes++,
    onSubmittedForReview: () => calls.reviews++,
    onLog() {},
    onClose() {},
    setAbandonSubmitting() {},
    setAbandonOpen() {},
    toDateInputValue: (value) => value,
    window: { dispatchEvent: (event) => calls.events.push(event) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setSubmitting() {},
    createTasksFromProposal: async (status) => { calls.creations.push(status); return []; },
    recomputeRdDirectorDashboard: async () => {},
    notifyCompleted: async () => {},
    handleClose() {},
    tasks: [],
    ...overrides,
  };
  return { calls, scope };
}

test("研发成员立项直接生效，不扩大角色或依赖审批流可用性", async () => {
  const { calls, scope } = harness("rd");
  const bindings = pageBindings(proposal, ["proposalApprovalRequired", "canCreateDirectly", "effectiveUserRole", "handleDirectDispatch"], scope);
  assert.equal(bindings.proposalApprovalRequired, false);
  assert.equal(bindings.effectiveUserRole, "user");
  assert.equal(bindings.canCreateDirectly, true);
  await bindings.handleDirectDispatch();
  assert.deepEqual(calls.creations, ["in_progress"]);
  assert.deepEqual(calls.errors, []);
});

test("协同和生产成员仍无直接立项权限，研发无立项权限账号也不能创建", async () => {
  for (const area of ["us-collab", "production", "rd"]) {
    const { calls, scope } = harness(area, { canSubmitProposal: area !== "rd" });
    const bindings = pageBindings(proposal, ["proposalApprovalRequired", "canCreateDirectly", "handleDirectDispatch"], scope);
    assert.equal(bindings.canCreateDirectly, false);
    await bindings.handleDirectDispatch();
    assert.deepEqual(calls.creations, []);
    assert.equal(calls.errors.length, 1);
  }
});

test("研发协作变更直接保存，协同和生产仍提交协作审核", async () => {
  for (const area of ["rd", "us-collab", "production"]) {
    const { calls, scope } = harness(area);
    const bindings = pageBindings(workspace, ["directTaskChanges", "canApplyCollaborationDirectly", "submitHandoff"], scope);
    bindings.submitHandoff();
    await calls.confirms[0].onConfirm();
    const payload = calls.updates[0].payload;
    if (area === "rd") {
      assert.deepEqual(payload, { collaborators: scope.selectedCollaborators });
      assert.equal(calls.events.length, 0);
    } else {
      assert.equal(payload.status, "pending_review");
      assert.equal(payload.pending_review_type, "collaboration");
      assert.deepEqual(payload.pending_collaborators, scope.selectedCollaborators);
    }
  }
});

test("研发截止日期只更新日期并刷新任务，不变更状态或标为待审", async () => {
  const { calls, scope } = harness("rd", { dueDateReason: "" });
  const bindings = pageBindings(workspace, ["directTaskChanges", "submitDueDateChange"], scope);
  bindings.submitDueDateChange();
  assert.equal(calls.confirms[0].confirmLabel, "保存日期");
  await calls.confirms[0].onConfirm();
  assert.deepEqual(calls.updates, [{ id: "RD-1", payload: { due_date: "2026-09-10" } }]);
  assert.equal(calls.refreshes, 1);
  assert.equal(calls.reviews, 0);
  assert.equal(calls.events.length, 0);
});

test("协同和生产改日期仍要求原因并保存待审核申请", async () => {
  for (const area of ["us-collab", "production"]) {
    const { calls, scope } = harness(area);
    const bindings = pageBindings(workspace, ["directTaskChanges", "submitDueDateChange"], scope);
    bindings.submitDueDateChange();
    await calls.confirms[0].onConfirm();
    assert.equal(calls.updates[0].payload.pending_review_type, "due_date");
    assert.equal(calls.updates[0].payload.pending_due_date, "2026-09-10");
    assert.equal(calls.updates[0].payload.status, "pending_review");
    assert.equal(calls.reviews, 1);
    const missingReason = harness(area, { dueDateReason: "" });
    pageBindings(workspace, ["directTaskChanges", "submitDueDateChange"], missingReason.scope).submitDueDateChange();
    assert.equal(missingReason.calls.confirms.length, 0);
    assert.equal(missingReason.calls.errors.length, 1);
  }
});

test("成果验收和放弃任务继续提交审核", async () => {
  const { calls, scope } = harness("rd");
  const bindings = pageBindings(workspace, ["submitResult", "submitAbandon"], scope);
  bindings.submitResult();
  await calls.confirms[0].onConfirm();
  await bindings.submitAbandon();
  assert.deepEqual(calls.updates.map(({ payload }) => [payload.status, payload.pending_review_type]), [
    ["pending_review", "result"], ["pending_review", "abandon"],
  ]);
  assert.equal(calls.reviews, 2);
});

test("只有研发已取消审批的存量申请可由参与人应用，其他工作区和成果放弃保持审批", () => {
  for (const area of ["rd", "us-collab", "production"]) {
    for (const review of ["proposal", "collaboration", "due_date", "merge", "result", "abandon"]) {
      const { scope } = harness(area, {
        task: { status: "pending_review", pending_review_type: review },
        taskReadOnly: false, canManage: false, isParticipant: true,
      });
      const bindings = pageBindings(detail, ["directChangePending", "canApplyPendingChange"], scope);
      assert.equal(bindings.canApplyPendingChange, area === "rd" && !["result", "abandon"].includes(review));
      const unrelated = pageBindings(detail, ["directChangePending", "canApplyPendingChange"], { ...scope, isParticipant: false });
      assert.equal(unrelated.canApplyPendingChange, false);
    }
  }
});
