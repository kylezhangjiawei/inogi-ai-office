import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function componentCount(page, componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

const page = source("src/app/RDApprovalFlowPage.tsx");
const config = source("src/app/lib/approvalFlowConfig.ts");

test("研发与协同审批流共用 Horizon 页面并保持恰好四项指标", () => {
  assert.match(page, /className="horizon-theme hz-page/);
  assert.equal(componentCount(page, "HorizonPageHeader"), 1);
  assert.equal(componentCount(page, "HorizonMetricGrid"), 1);
  assert.equal(componentCount(page, "HorizonMetric"), 4);
  assert.match(page, /isUsCollabWorkspace\(\)/);
  assert.match(page, /协同审批流配置/);
  assert.match(page, /审批流配置/);
  assert.match(page, /协同立项审批 · 默认流程/);
  assert.match(page, /DEFAULT_PROJECT_FLOW/);
});

test("审批流继续按工作区隔离缓存、接口上下文和默认模板", () => {
  assert.match(config, /isUsCollabWorkspace\(\) \? "rd-approval-flows-v1\.us-collab" : "rd-approval-flows-v1"/);
  assert.match(config, /fetchRdApprovalFlows<ApprovalFlow>/);
  assert.match(config, /saveRdApprovalFlows\(flows, baseFlows\)/);
  assert.match(page, /fetchFlowsApi\(\)/);
  assert.match(page, /loadFlows\(\)/);
  assert.match(page, /saveFlows\(nextFlows, savedFlowsRef\.current\)/);
  assert.match(page, /cloneDefaultFlow\(\)/);
});

test("审批流保留节点编排、成员池和权限守卫", () => {
  assert.match(page, /usePermission\(PERMISSIONS\.RD_APPROVAL_FLOW_MANAGE\)/);
  assert.match(page, /if \(!canManageFlow\) return;/);
  assert.match(page, /fetchApprovalPoolsApi\(permissionKey\.split\("\\|"\)\)/);
  assert.match(page, /fetchApprovalCandidatesApi\(\)/);
  assert.match(page, /effectiveNodePool\(node, derived\)/);
  assert.match(page, /excluded_member_ids:/);
  assert.match(page, /extra_members:/);
  assert.match(page, /const moveNode =/);
  assert.match(page, /const addNode =/);
  assert.match(page, /const deleteNode =/);
  assert.match(page, /nodes: nodes\.map\(\(node, nextIndex\) => \(\{ \.\.\.node, level: nextIndex \+ 1 \}\)\)/);
  assert.match(page, /updated_at: new Date\(\)\.toISOString\(\)/);
});

test("恢复默认和删除节点使用项目 AlertDialog 并恢复焦点", () => {
  assert.equal(componentCount(page, "AlertDialog"), 2);
  assert.equal(componentCount(page, "AlertDialogContent"), 2);
  assert.match(page, /<AlertDialog open=\{confirmReset\}/);
  assert.match(page, /<AlertDialogTitle[^>]*>\{t\("恢复默认审批流？"\)\}<\/AlertDialogTitle>/);
  assert.match(page, /className="horizon-portal" onCloseAutoFocus=\{restoreDialogFocus\}/);
  assert.equal((page.match(/onCloseAutoFocus=\{restoreDialogFocus\}/g) ?? []).length, 2);
  assert.match(page, /if \(trigger\?\.isConnected\) trigger\.focus\(\)/);
  assert.doesNotMatch(page, /createPortal|role="alertdialog"|fixed\s+inset|DIALOG_FOCUSABLE_SELECTOR/);
});

test("节点表单提供语义标签、内联错误、焦点定位和结构化状态", () => {
  assert.match(page, /<ol className="min-w-0" aria-label=\{t\("审批节点顺序"\)\}>/);
  assert.match(page, /<Label htmlFor=\{labelId\}/);
  assert.match(page, /<Label htmlFor=\{permissionId\}/);
  assert.match(page, /<Label htmlFor=\{slaId\}/);
  assert.match(page, /aria-invalid=\{Boolean\(errors\?\.label\)\}/);
  assert.match(page, /aria-invalid=\{Boolean\(errors\?\.sla\)\}/);
  assert.match(page, /首个生效节点暂不支持会签/);
  assert.match(page, /disabled=\{readOnly \|\| \(isFirst && option\.value === "all"\)\}/);
  assert.match(page, /SLA 时长必须是大于 0 的整数/);
  assert.match(page, /fieldRefs\.current\.get\(validation\.firstKey/);
  assert.match(page, /function ApprovalFlowLoading\(\)/);
  assert.match(page, /<HorizonEmptyState/);
  assert.match(page, /role="alert"/);
  assert.match(page, /const requestId = \+\+flowRequestRef\.current/);
  assert.match(page, /const requestId = \+\+candidateRequestRef\.current/);
  assert.match(page, /const requestId = \+\+poolRequestRef\.current/);
});

test("审批流页面不包含被禁用的视觉和手写交互模式", () => {
  const forbidden = [
    ["未定义旧分支", /horizonVariant/],
    ["渐变", /gradient/i],
    ["紫色类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["全量过渡", /transition-all/],
    ["悬停位移", /hover:-translate/],
    ["大面积模糊", /backdrop-blur/],
    ["固定视口高度", /\bh-screen\b/],
    ["原生确认框", /window\.confirm\s*\(/],
  ];
  for (const [name, pattern] of forbidden) {
    assert.doesNotMatch(page, pattern, `审批流页面不应包含${name}`);
  }
});
