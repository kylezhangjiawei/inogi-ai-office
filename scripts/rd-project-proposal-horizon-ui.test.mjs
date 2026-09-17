import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/app/RDProjectProposalDialog.tsx", import.meta.url),
  "utf8",
);

test("共享立项向导使用项目 Dialog 原语承接焦点、Esc 与关闭行为", () => {
  assert.match(source, /from "\.\/components\/ui\/dialog"/);
  for (const primitive of ["Dialog", "DialogClose", "DialogContent", "DialogDescription", "DialogTitle"]) {
    assert.match(source, new RegExp(`\\b${primitive}\\b`), `应继续使用 ${primitive}`);
  }
  assert.match(source, /<Dialog[\s\S]*open=\{open\}[\s\S]*onOpenChange=/);
  assert.match(source, /if \(!nextOpen && !submitting\) handleClose\(\)/);
  assert.match(source, /<DialogContent[\s\S]*className="horizon-portal rd-horizon-project-proposal/);
  assert.match(source, /onEscapeKeyDown=\{\(event\) => \{[\s\S]*if \(submitting\) event\.preventDefault\(\)/);
  assert.match(source, /onPointerDownOutside=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.doesNotMatch(source, /role="dialog"|aria-modal="true"|fixed inset-0|handleDialogKeyDown|dialogRef|returnFocusRef/);
  assert.doesNotMatch(source, /querySelectorAll<HTMLElement>|requestAnimationFrame\(\(\) => .*focus/);
});

test("四步立项、AI 生成微调、附件与审批业务契约保持完整", () => {
  assert.match(source, /type Step = 1 \| 2 \| 3 \| 4/);
  assert.match(source, /step === 1 && \([\s\S]*<StepInput/);
  assert.match(source, /step === 2 && <StepProcessing/);
  assert.match(source, /step === 3 && \([\s\S]*<StepReview/);
  assert.match(source, /step === 4 && \([\s\S]*<StepSubmit/);
  assert.match(source, /extractRdTasksFromFile\(\{/);
  assert.match(source, /extractRdTasksFromText\(\{/);
  assert.match(source, /refineRdProposalTasks\(\{/);
  assert.match(source, /saveRdProposalDraft\(\{/);
  assert.match(source, /createRdTasksBatch\(topLevelPayloads, proposalId\)/);
  assert.doesNotMatch(source, /createRdTask\(taskPayload/);
  assert.match(source, /createRdSubtasks\(parentTask\.task_id, childPayloads, proposalId\)/);
  assert.match(source, /ensureRdProposalTarget\(/);
  assert.match(source, /fetchApprovalPoolsApi\(permissionCodes\)/);
  assert.match(source, /fetchFlowsApi\(\)/);
  assert.match(source, /approvalFlowRequestRef/);
  assert.match(source, /effectiveNodePool\(node, approvalPools\[node\.permission_code\]/);
  assert.match(source, /forceOwnerToCurrentUser/);
  assert.match(source, /multiple[\s\S]*onChange=\{handleFileInputChange\}/);
  assert.match(source, /PROPOSAL_ATTACHMENT_ACCEPT/);
  assert.match(source, /parseSeqRef/);
  assert.match(source, /openSessionRef/);
  assert.match(source, /approvalModeUnsupported/);
  assert.match(source, /当前版本尚未实现会签的逐人完成状态/);
});

test("立项向导统一 Horizon 主题 强调并清除旧高噪声视觉", () => {
  assert.match(source, /bg-primary/);
  assert.match(source, /bg-accent/);
  assert.match(source, /hz-primary-action/);
  assert.doesNotMatch(source, /\b(?:indigo|violet|purple|fuchsia|pink)-/i);
  assert.doesNotMatch(source, /\bdark:/);
  assert.doesNotMatch(source, /bg-gradient|linear-gradient|radial-gradient/i);
  assert.doesNotMatch(source, /\btracking-(?:tight|wide|wider|widest|\[[^\]]+\])/);
  assert.doesNotMatch(source, /\btransition-all\b/);
  assert.doesNotMatch(source, /hover:-translate|group-hover:-translate/);
});

test("立项向导满足基础排版、数字与图标按钮可访问性约束", () => {
  assert.match(source, /text-balance/);
  assert.match(source, /text-pretty/);
  assert.match(source, /tabular-nums/);
  assert.match(source, /aria-label=\{t\("关闭"\)\}/);
  assert.match(source, /aria-label=\{t\("请 AI 微调此任务"\)\}/);
  assert.match(source, /aria-label=\{t\("删除任务 \{title\}"/);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuenow=\{step\}/);
});
