import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { matchPath, matchRoutes } from "react-router";
import ts from "typescript";

const appSource = readFileSync(
  new URL("../src/app/App.tsx", import.meta.url),
  "utf8",
);
const routePathsSource = readFileSync(new URL("../src/app/lib/routePaths.ts", import.meta.url), "utf8");
const rdWorkspaceSource = readFileSync(new URL("../src/app/lib/rdWorkspace.ts", import.meta.url), "utf8");
const mobileSource = readFileSync(
  new URL("../src/app/MobileRDCockpit.tsx", import.meta.url),
  "utf8",
);

const shellSource = readFileSync(
  new URL("../src/app/MobileShell.tsx", import.meta.url),
  "utf8",
);
const rootSource = readFileSync(
  new URL("../src/app/Root.tsx", import.meta.url),
  "utf8",
);
const loginSource = readFileSync(
  new URL("../src/app/LoginPage.tsx", import.meta.url),
  "utf8",
);
const recordFooterSource = readFileSync(
  new URL("../src/app/components/SiteRecordFooter.tsx", import.meta.url),
  "utf8",
);
const publicSecurityRecordIcon = readFileSync(
  new URL("../public/gongan.png", import.meta.url),
);

function sourceFunction(source, name, scope) {
  const ast = ts.createSourceFile("routing.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `missing ${name}`);
  const javascript = ts.transpileModule(`${declaration.getText(ast).replace(/^export\s+/, "")}\nreturn ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), javascript)(...Object.values(scope));
}

function descendants(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(descendants)];
}

test("聊天分析自定义路径后，手机入口与宽屏返回仍匹配同一页面", () => {
  for (const desktopPath of ["/chat-analytics", "/chat-feedback", "/reports/chat-feedback"]) {
    const routePath = (code, fallback) => code === "page:chat-analytics" ? desktopPath : fallback;
    const mobilePath = `/m${desktopPath}`;
    const location = { pathname: desktopPath, search: "?from=us-collab", hash: "#quality" };
    const protectedLayout = sourceFunction(appSource, "ProtectedLayout", {
      React, Navigate: "Navigate", useAuth: () => ({ user: { id: "test" }, hydrated: true }),
      useLocation: () => location, useIsMobileViewport: () => true, routePath, matchPath,
      subRoutePath: sourceFunction(routePathsSource, "subRoutePath", { routePath }),
      rdWorkspaceForPath: sourceFunction(rdWorkspaceSource, "rdWorkspaceForPath", { routePath, matchPath }),
    });
    assert.equal(protectedLayout().props.to, `${mobilePath}?from=us-collab#quality`);

    const desktopTarget = sourceFunction(appSource, "desktopTargetFromMobileLocation", { routePath });
    assert.equal(desktopTarget(mobilePath, location.search, location.hash), `${desktopPath}?from=us-collab#quality`);

    for (const fromCollaboration of [false, true]) {
      let navigated;
      const components = Object.fromEntries([...shellSource.matchAll(/<([A-Z]\w*)\b/g)].map((match) => [match[1], match[1]]));
      const mobileLayout = sourceFunction(shellSource, "MobileLayout", {
        ...components, React, routePath, MENU_OVERLAY: "mobile-shell-menu",
        useI18n() {}, useEffect() {}, useState: () => [false, () => {}], useMobileOverlayBack() {},
        useAuth: () => ({ user: { name: "Test", permissions: ["page:chat-analytics"] }, hydrated: true }),
        useLocation: () => ({ pathname: mobilePath, search: fromCollaboration ? "?from=us-collab" : "" }),
        useNavigate: () => (path) => { navigated = path; }, hasPermission: () => true,
        isProductionWorkspace: () => false, isUsCollabWorkspace: () => false,
        t: (key) => key, cn: () => "", isCurrentMobileOverlay: () => false,
        window: { requestAnimationFrame() {} },
      });
      const menu = descendants(mobileLayout()).find((element) => element.type === "Button"
        && React.Children.toArray(element.props.children).includes("AI 使用与反馈"));
      assert.ok(menu, "应存在聊天分析菜单入口");
      assert.equal(menu.props["aria-current"], "page");
      menu.props.onClick();
      assert.equal(navigated, `${mobilePath}${fromCollaboration ? "?from=us-collab" : ""}`);
      const match = matchRoutes([{ path: "/m", children: [{ path: desktopPath.slice(1) }, { path: "*" }] }], navigated);
      assert.equal(match.at(-1).route.path, desktopPath.slice(1), "菜单必须命中聊天分析，不能落入驾驶舱兜底");
    }
  }
});


test("移动端路由只在窗口尺寸稳定后切换", () => {
  assert.match(appSource, /MOBILE_VIEWPORT_DEBOUNCE_MS\s*=\s*250/);
  assert.match(appSource, /window\.clearTimeout\(resizeTimer\)/);
  assert.match(
    appSource,
    /resizeTimer\s*=\s*window\.setTimeout\([\s\S]*?setMobile\(isMobileViewport\(\)\)[\s\S]*?MOBILE_VIEWPORT_DEBOUNCE_MS/,
  );
});

test("移动路由恢复宽屏后自动回到对应桌面页面", () => {
  assert.match(appSource, /function ResponsiveMobileLayout\(\)/);
  assert.match(appSource, /if \(!isMobile\)\s*{[\s\S]*?<Navigate to=\{desktopTarget\} replace/);
  assert.match(appSource, /path:\s*"\/m",\s*\n\s*Component:\s*ResponsiveMobileLayout/);
  assert.match(appSource, /path:\s*"\/us-collab-m",\s*\n\s*Component:\s*ResponsiveMobileLayout/);
  assert.match(appSource, /\/rd-discussion\/\$\{encodeURIComponent\(discussionMatch\[2\]\)\}/);
  assert.match(appSource, /\/us-collab-rd-discussion\/\$\{encodeURIComponent\(discussionMatch\[2\]\)\}/);
  assert.match(appSource, /routePath\("page:rd-task-management",\s*"\/rd-task-management"\)/);
  assert.match(appSource, /routePath\("page:us-collab-cockpit",\s*"\/us-collab-cockpit"\)/);
  assert.match(appSource, /path:\s*"\/production-m",\s*\n\s*Component:\s*ResponsiveMobileLayout/);
  assert.match(appSource, /path:\s*"task\/:taskId"/);
  assert.match(appSource, /\/production-task\/\$\{encodeURIComponent\(taskMatch\[2\]\)\}/);
});

test("移动任务详情保留任务 ID 和工作区上下文", () => {
  assert.match(mobileSource, /useParams<\{ taskId: string \}>\(\)/);
  assert.match(mobileSource, /taskIndex\.byId\.get\(routeTaskId\)/);
  assert.match(mobileSource, /navigate\([\s\S]*?workspaceBase[\s\S]*?encodeURIComponent\(task\.task_id\)/);
  assert.match(mobileSource, /const MOBILE_DATA_REFRESH_INTERVAL_MS = 15_000/);
  assert.match(mobileSource, /window\.setInterval\(refresh, MOBILE_DATA_REFRESH_INTERVAL_MS\)/);
});

test("生产移动端按与接口相同的路由身份识别工作区", () => {
  assert.match(shellSource, /isProductionWorkspace\(\)/);
  assert.match(shellSource, /isProduction \? "\/production-m" : "\/m"/);
  assert.match(appSource, /const workspace = rdWorkspaceForPath\(location\.pathname\)/);
  assert.match(appSource, /workspace === "production" \|\| location\.pathname === "\/rd-director-dashboard"/);
});

test("移动驾驶舱复用对应桌面端权限边界", () => {
  assert.equal((appSource.match(/makeLazyProtected\(<MobileRDCockpit \/>, \["page:rd-task-management", "page:rd-my-workspace"\]\)/g) ?? []).length, 2,
    "研发移动首页和任务详情都允许驾驶舱或个人工作台权限，不能省略页面权限检查");
  assert.match(appSource, /makeLazyProtected\(<MobileRDCockpit \/>, "page:us-collab-cockpit"\)/);
  assert.match(appSource, /makeLazyProtected\(<MobileRDCockpit \/>, "page:rd-director-dashboard"\)/);
  assert.doesNotMatch(
    appSource,
    /\{ index: true, element: lazyWrap\(<MobileRDCockpit \/>\) \}/,
  );
});

test("移动任务切换按任务 ID 重挂详情组件", () => {
  assert.match(mobileSource, /<MobileTaskDetail[\s\S]*?key=\{activeTask\.task_id\}/);
});

test("移动端壳层随长内容增长，备案栏不会停在首屏中部", () => {
  assert.match(shellSource, /<div className="flex min-h-\[100dvh\] flex-col bg-card">/);
  assert.match(shellSource, /<main className="flex-1 bg-background">[\s\S]*?<Outlet \/>[\s\S]*?<\/main>/);
  assert.doesNotMatch(shellSource, /<div className="flex h-\[100dvh\] flex-col\b/);
  assert.doesNotMatch(shellSource, /<main className="[^"]*\bmin-h-0\b/);
});

test("备案链接保留且仅在登录页透明展示，业务壳由组件统一隐藏", () => {
  assert.match(recordFooterSource, /苏ICP备2021046412号-3/);
  assert.match(recordFooterSource, /https:\/\/beian\.miit\.gov\.cn\/#\/Integrated\/index/);
  assert.match(recordFooterSource, /苏公网安备32011202001840号/);
  assert.match(recordFooterSource, /https:\/\/www\.beian\.gov\.cn\/portal\/registerSystemInfo\?recordcode=/);
  assert.match(recordFooterSource, /PUBLIC_SECURITY_RECORD_CODE = "32011202001840"/);
  assert.match(recordFooterSource, /<img src="\/gongan\.png" alt="公安备案图标" width=\{18\} height=\{18\}/);
  assert.deepEqual(
    [...publicSecurityRecordIcon.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.match(recordFooterSource, /target="_blank"/);
  assert.match(recordFooterSource, /rel="noopener noreferrer"/);
  assert.match(rootSource, /<SiteRecordFooter tone="horizon" className="backdrop-blur-none" \/>/);
  assert.match(shellSource, /<SiteRecordFooter tone="horizon" className="pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\] backdrop-blur-none" \/>/);
  assert.match(loginSource, /<SiteRecordFooter className="mt-4 w-full max-w-5xl" \/>/);
  assert.match(recordFooterSource, /useMatch\("\/login"\)/);
  assert.match(recordFooterSource, /display: isLoginPage \? "flex" : "none", background: "transparent"/);
});
