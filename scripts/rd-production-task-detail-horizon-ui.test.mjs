import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailSource = await readFile(
  new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/app/App.tsx", import.meta.url),
  "utf8",
);

test("生产任务详情路由与研发详情共用 Horizon 视觉作用域", () => {
  assert.match(
    appSource,
    /path: "production-task\/:taskId"[\s\S]{0,180}<RDTaskDetailPage key="ws-production-detail" \/>[\s\S]{0,100}"page:rd-director-dashboard"/,
  );
  assert.match(
    detailSource,
    /const RD_TASK_DETAIL_HORIZON_SCOPE = "rd-horizon-module rd-horizon-task-detail";/,
  );
  assert.match(
    detailSource,
    /className=\{cn\(\s*RD_TASK_DETAIL_HORIZON_SCOPE,\s*researchWorkspace && "rd-reference-detail",\s*"mx-auto flex max-w-\[1440px\]/,
  );
  assert.match(detailSource, /<div className="rd-horizon-detail-shell">/);
  assert.match(detailSource, /<div className="rd-horizon-detail-context">/);
  assert.match(detailSource, /<div className="rd-horizon-detail-orientation">/);
  assert.match(detailSource, /<div className="rd-horizon-detail-state">/);
});

test("权限、加载、空态与弹层不再按生产工作区关闭 Horizon", () => {
  const scopedStateCount = (
    detailSource.match(/className=\{cn\(RD_TASK_DETAIL_HORIZON_SCOPE, "flex min-h-\[40vh\]/g) ?? []
  ).length;
  assert.equal(scopedStateCount, 3, "权限、加载与空/错误态应全部继承 Horizon 作用域");
  assert.match(detailSource, /<HandoverDialog[\s\S]{0,220}\shorizonVariant\s/);
  assert.match(detailSource, /<CreateSubtaskDialog[\s\S]{0,180}\shorizonVariant\s/);
  assert.match(detailSource, /className="rd-horizon-detail-select rounded-xl/);
  assert.match(detailSource, /className="rd-horizon-detail-dialog rounded-2xl/);

  assert.doesNotMatch(detailSource, /!productionWorkspace && "rd-horizon-module rd-horizon-task-detail"/);
  assert.doesNotMatch(detailSource, /productionWorkspace \? "contents" : "rd-horizon-detail-/);
  assert.doesNotMatch(detailSource, /horizonVariant=\{!productionWorkspace\}/);
  assert.doesNotMatch(detailSource, /!productionWorkspace && "rd-horizon-detail-(?:select|dialog)"/);
});

test("生产保留原路由与业务门禁，研发详情按页面权限返回驾驶舱或个人工作台", () => {
  assert.match(detailSource, /const productionWorkspace = isProductionWorkspace\(\);/);
  assert.match(detailSource, /const canOpenRdCockpit = usePermission\(PERMISSIONS\.PAGE_RD_TASK_MANAGEMENT\);/);
  assert.match(
    detailSource,
    /const cockpitPath = productionWorkspace\s*\? "\/production-dashboard"\s*: canOpenRdCockpit \? routePath\("page:rd-task-management", "\/rd-task-management"\) : routePath\("page:rd-my-workspace", "\/rd-my-workspace"\);/,
  );
  assert.match(detailSource, /const cockpitReturnPath = `\$\{cockpitPath\}\$\{location\.search\}`;/);
  assert.match(detailSource, /const canViewRd = useAnyPermission\(PERMISSIONS\.PAGE_RD_TASK_MANAGEMENT, PERMISSIONS\.PAGE_RD_MY_WORKSPACE\);/);
  assert.match(detailSource, /const canViewProduction = usePermission\(PERMISSIONS\.PAGE_RD_DIRECTOR_DASHBOARD\);/);
  assert.match(detailSource, /const canView = productionWorkspace \? canViewProduction : canViewRd;/);
  assert.match(
    detailSource,
    /\(id: string\) => `\$\{productionWorkspace \? "\/production-task" : "\/rd-task"\}\/\$\{encodeURIComponent\(id\)\}/,
  );
  assert.match(detailSource, /useAuditActor\(productionWorkspace \? "生产管理员" : "研发管理员"\)/);
  assert.match(detailSource, /if \(productionWorkspace \|\| !canSyncProduction\) \{/);
  assert.match(
    detailSource,
    /if \(!task \|\| productionSyncing \|\| productionWorkspace \|\| !canSyncProduction\) return;/,
  );
  assert.match(detailSource, /!productionWorkspace && canSyncProduction && \(/);
  assert.match(
    detailSource,
    /<DetailGridOrder productionWorkspace=\{productionWorkspace\}>/,
    "生产与研发的左右栏顺序判断不能被视觉改造删除",
  );
});
