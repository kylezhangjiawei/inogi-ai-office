import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const workspacePage = source("src/app/RDMyWorkspacePage.tsx");
const aiSettingsPage = source("src/app/RDAiSettingsPage.tsx");
const cockpitPage = source("src/app/RDTaskManagementPage.tsx");
const appRoutes = source("src/app/App.tsx");
const rdApi = source("src/app/lib/rdApi.ts");

test("中美协同驾驶舱完整继承 Horizon 外壳与下钻视觉", () => {
  assert.match(cockpitPage, /const horizonCockpit = true;/);
  assert.match(cockpitPage, /horizonCockpit && "rd-horizon-module"/);
  assert.match(cockpitPage, /horizonVariant=\{horizonCockpit\}/);
  assert.match(cockpitPage, /horizonCockpit && "rd-horizon-module-dialog"/);
  assert.match(cockpitPage, /horizonCockpit && "rd-horizon-module rd-horizon-people-page"/);
  assert.match(cockpitPage, /horizonCockpit && "rd-horizon-module rd-horizon-board"/);
  assert.doesNotMatch(
    cockpitPage,
    /const horizonCockpit = !usCollab;/,
    "中美协同不应再被驾驶舱 Horizon 视觉排除",
  );
});

test("中美协同 Horizon 接入保留独立布局、数据边界与研发专属搜索", () => {
  assert.match(cockpitPage, /const usCollabLayout = isUsCollabWorkspace\(\);/);
  assert.match(cockpitPage, /\{usCollabLayout \? \(/);
  assert.match(cockpitPage, /const nativeRdCockpit = !usCollab && !productionWorkspace;/);
  assert.match(cockpitPage, /onSearchKeywordChange=\{nativeRdCockpit \? handleCockpitSearchKeywordChange : undefined\}/);
  assert.match(cockpitPage, /const canViewCombinedMemberTasks = !usCollab && !productionWorkspace && canReassignTasks;/);
  assert.match(cockpitPage, /const canSyncProduction = canSyncProductionPermission && !usCollab && !productionWorkspace;/);
  assert.match(cockpitPage, /hideSystemPanorama=\{hideSystemPanorama\}/);
  assert.match(
    appRoutes,
    /page:us-collab-cockpit[\s\S]{0,220}<RDTaskManagementPage key="ws-us" hideSystemPanorama \/>[\s\S]{0,120}page:us-collab-cockpit/,
  );
});

test("RD 与美国协同工作台共用 Horizon 视觉，生产工作区仍排除", () => {
  assert.equal(
    (workspacePage.match(/const horizonWorkspace = !isProductionWorkspace\(\);/g) ?? []).length,
    2,
    "页面根和任务卡应使用同一非生产 Horizon 门控",
  );
  assert.match(
    workspacePage,
    /horizonWorkspace && "rd-horizon-module rd-horizon-workspace"/,
  );
  assert.doesNotMatch(
    workspacePage,
    /const horizonWorkspace\s*=\s*!isUsCollabWorkspace\(\)\s*&&\s*!isProductionWorkspace\(\)/,
    "美国协同不应再被 Horizon 变体排除",
  );
});

test("RD 与美国协同 AI 设置共用 Horizon 视觉，但保留协同文案判定", () => {
  assert.match(aiSettingsPage, /const usCollabWorkspace = isUsCollabWorkspace\(\);/);
  assert.match(aiSettingsPage, /const productionWorkspace = isProductionWorkspace\(\);/);
  assert.match(aiSettingsPage, /const isHorizon = !productionWorkspace;/);
  assert.match(aiSettingsPage, /isHorizon && "rd-horizon-module rd-horizon-ai-settings"/);
  assert.match(aiSettingsPage, /usCollabWorkspace \? "Collab AI Policy" : "R&D AI Policy"/);
  assert.doesNotMatch(
    aiSettingsPage,
    /const isHorizon = !usCollabWorkspace\s*&&/,
    "美国协同 AI 设置不应再被 Horizon 变体排除",
  );
});

test("美国协同路由继续使用独立组件实例与权限守卫", () => {
  assert.match(
    appRoutes,
    /page:us-collab-workspace[\s\S]{0,180}<RDMyWorkspacePage key="ws-us" \/>[\s\S]{0,120}page:us-collab-workspace/,
  );
  assert.match(
    appRoutes,
    /page:us-collab-ai-settings[\s\S]{0,180}<RDAiSettingsPage key="ws-us" \/>[\s\S]{0,120}page:us-collab-ai-settings/,
  );
  assert.match(appRoutes, /<RDMyWorkspacePage key="ws-rd" \/>/);
  assert.match(appRoutes, /<RDAiSettingsPage \/>/);
});

test("三套人员管理路由统一启用 Horizon 视觉且保留实例与权限契约", () => {
  for (const [path, key] of [
    ["rd-people-management", "ws-rd"],
    ["us-collab-people-management", "ws-us"],
    ["production-people-management", "ws-production"],
  ]) {
    const escapedPath = path.replaceAll("-", "\\-");
    assert.match(
      appRoutes,
      new RegExp(
        `path: "${escapedPath}"[^\\n]+<RDPeopleManagementPage key="${key}" visualVariant="rd-horizon" onBack=\\{\\(\\) => window\\.history\\.back\\(\\)\\} \\/>[^\\n]+"rd-people:manage"`,
      ),
      `${path} 应保留独立实例、返回逻辑与权限守卫，并启用 Horizon 视觉`,
    );
  }
});

test("Horizon 放开不改变工作区识别、数据过滤和 API 参数隔离", () => {
  assert.match(rdApi, /import \{ currentRdWorkspace \} from "\.\/rdWorkspace"/);
  assert.match(rdApi, /return currentRdWorkspace\(\) === "us-collab"/);
  assert.match(rdApi, /return currentRdWorkspace\(\) === "production"/);
  assert.match(rdApi, /workspace=\$\{encodeURIComponent\(workspace\)\}/);
  assert.match(rdApi, /RD_API_BASE\}\$\{withWorkspace\(path\)\}/);

  assert.match(workspacePage, /fetchRdWorkspace\(\{ includeCollaboration: !isUsCollabWorkspace\(\) \}\)/);
  assert.match(workspacePage, /const currentWorkspace = isUsCollabWorkspace\(\) \? "us-collab" : "rd";/);
  assert.match(workspacePage, /task\.source_workspace \?\? \(isUsCollabWorkspace\(\) \? "us-collab" : "rd"\)/);

  assert.match(aiSettingsPage, /await fetchRdAiSettings\(\)/);
  assert.match(aiSettingsPage, /await saveRdAiSettings\(submittedSettings, submittedBaseUpdatedAt\)/);
  assert.match(rdApi, /base_updated_at: baseUpdatedAt/);
  assert.match(rdApi, /requestJson<RdAiSettingsPayload>\("\/ai-settings"\)/);
  assert.match(rdApi, /requestJson<RdAiSettingsPayload>\("\/ai-settings", \{/);
});
