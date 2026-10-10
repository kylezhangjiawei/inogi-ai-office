import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getReviewTypeMeta } from "../src/app/lib/reviewTypes.ts";

const proposal = readFileSync(new URL("../src/app/RDProjectProposalDialog.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/app/RDMyWorkspacePage.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
const dialogs = readFileSync(new URL("../src/app/rd/TaskActionDialogs.tsx", import.meta.url), "utf8");

// Execute the page's actual event handlers with API/UI effects supplied by the test.
function pageBindings(source, names, dependencies) {
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      declarations.set(node.name.text, node.getText(ast).replace(/^export\s+/, ""));
    }
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
    { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
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

test("研发成果与其他工作区一样提交管理员审核；放弃仍审核", async () => {
  for (const area of ["rd", "us-collab", "production"]) {
    const { calls, scope } = harness(area);
    const bindings = pageBindings(workspace, ["directTaskChanges", "submitResult", "submitAbandon"], scope);
    bindings.submitResult();
    await calls.confirms[0].onConfirm();
    assert.deepEqual(calls.updates[0].payload, { status: "pending_review", pending_review_type: "result", progress: 100 });
    assert.equal(calls.reviews, 1);
    assert.equal(calls.refreshes, 0);
    assert.equal(calls.events.length, 1);
    assert.equal(calls.confirms[0].confirmLabel, "确认提交");
    await bindings.submitAbandon();
    assert.equal(calls.updates[1].payload.pending_review_type, "abandon");
    assert.equal(calls.updates[1].payload.status, "pending_review");
    assert.equal(calls.reviews, 2);
  }
});

test("研发完成保存失败不通知成功、不更新本地为完成", async () => {
  const { calls, scope } = harness("rd", { updateRdTask: async () => { throw new Error("保存失败"); } });
  pageBindings(workspace, ["directTaskChanges", "submitResult"], scope).submitResult();
  await assert.rejects(calls.confirms[0].onConfirm, /保存失败/);
  assert.equal(calls.refreshes, 0);
  assert.equal(calls.reviews, 0);
  assert.equal(calls.events.length, 0);
});

test("任务详情主责人提交成果审核，所有工作区保持一致", async () => {
  for (const area of ["rd", "us-collab", "production"]) {
    const { calls, scope } = harness(area, {
      researchWorkspace: area === "rd", canSubmitForReview: true,
      task: { task_id: "RD-1", status: "in_progress", progress: 50 },
      activeTaskIdRef: { current: "RD-1" }, setShowSubmitConfirm() {},
      loadTask: () => { calls.refreshes++; },
    });
    await pageBindings(detail, ["handleSubmitForReview"], scope).handleSubmitForReview();
    assert.deepEqual(calls.updates, [{ id: "RD-1", payload: { status: "pending_review", pending_review_type: "result", progress: 100 } }]);
    assert.equal(calls.events.length, 1);
    assert.equal(calls.refreshes, 1);
  }
});

test("详情页完成入口保持负责人及只读限制，离开任务后旧完成响应不刷新当前任务", async () => {
  for (const [isCurrentOwner, taskReadOnly, canManage] of [[false, false, false], [true, true, false], [true, false, true]]) {
    const { scope } = harness("rd", { task: { status: "in_progress" }, isCurrentOwner, taskReadOnly, canManage });
    assert.equal(pageBindings(detail, ["canSubmitForReview"], scope).canSubmitForReview, false);
  }
  const { calls, scope } = harness("rd", {
    researchWorkspace: true, canSubmitForReview: true,
    task: { task_id: "RD-1", status: "in_progress", progress: 50 },
    activeTaskIdRef: { current: "RD-1" }, setShowSubmitConfirm() {},
    loadTask: () => { calls.refreshes++; },
  });
  let complete;
  scope.updateRdTask = () => new Promise((resolve) => { complete = resolve; });
  const pending = pageBindings(detail, ["handleSubmitForReview"], scope).handleSubmitForReview();
  scope.activeTaskIdRef.current = "RD-2";
  complete();
  await pending;
  assert.equal(calls.refreshes, 0);
  assert.equal(calls.events.length, 0);
});

test("结项确认弹窗显示待管理员审核", () => {
  const { SubmitConfirmDialog } = pageBindings(dialogs, ["SubmitConfirmDialog"], {
    React, t: (text) => text, TaskActionDialogFrame: ({ children }) => React.createElement("section", null, children), DialogTitle: "h2",
    DialogDescription: "p", Button: "button", Send: () => null, Loader2: () => null,
  });
  const html = renderToStaticMarkup(React.createElement(SubmitConfirmDialog, { taskTitle: "回归任务", submitting: false, onConfirm() {}, onCancel() {} }));
  assert.match(html, /进入待审核/);
  assert.doesNotMatch(html, /无需审核/);
});

test("研发历史成果申请不可在工作台作为免审变更应用", () => {
  for (const type of ["result", "abandon", "due_date"]) {
    const { scope } = harness("rd", { task: { status: "pending_review", pending_review_type: type } });
    const result = pageBindings(workspace, ["directTaskChanges", "directChangePending"], scope);
    assert.equal(result.directChangePending, type === "due_date");
  }
});

test("新建子任务默认截止日期为打开当天，不继承父任务日期", () => {
  const wrapper = ({ children }) => React.createElement("div", null, children);
  let today = "2026-10-09";
  const { CreateSubtaskDialog } = pageBindings(detail, ["CreateSubtaskDialog"], {
    React, useState: React.useState, useMemo: React.useMemo, useI18n() {}, t: (key) => key,
    todayLocalDateStr: () => today, cn: () => "", displayPersonName: (name) => name,
    Dialog: wrapper, DialogContent: wrapper, DialogHeader: wrapper, DialogTitle: "h2", DialogDescription: "p",
    Select: wrapper, SelectTrigger: wrapper, SelectValue: () => null, SelectContent: wrapper, SelectItem: wrapper,
    Input: "input", Textarea: "textarea", Button: ({ children, variant, ...props }) => React.createElement("button", props, children),
    FileText: () => null, Loader2: () => null, CheckCircle2: () => null,
  });
  for (const date of ["2026-10-09", "2026-10-10"]) {
    today = date;
    const html = renderToStaticMarkup(React.createElement(CreateSubtaskDialog, { parentTask: { due_date: "2025-01-01" }, people: [], onConfirm() {}, onCancel() {} }));
    assert.match(html, new RegExp(`<input[^>]+type="date"[^>]+value="${date}"`));
  }
});

test("详情页当前审核入口只允许管理员，所有审核结果交由后端裁决", async () => {
  for (const area of ["rd", "us-collab", "production"]) {
    for (const review of ["proposal", "collaboration", "due_date", "merge", "result", "abandon"]) {
      for (const canManage of [false, true]) {
        const { calls, scope } = harness(area, {
          task: { task_id: 'RD-1', status: "pending_review", pending_review_type: review },
          taskReadOnly: false, canManage, showApproval: 'approve',
          activeTaskIdRef: { current: 'RD-1' }, AUDIT_ACTOR: { name: '审核管理员' },
          getReviewTypeMeta, setShowApproval() {}, loadTask() {},
        });
        await pageBindings(detail, ["handleApproval"], scope).handleApproval();
        assert.deepEqual(calls.updates, canManage ? [{ id: 'RD-1', payload: { _review_action: 'approve', _reviewer_name: '审核管理员' } }] : []);
        assert.deepEqual(calls.errors, []);
      }
    }
  }
});
