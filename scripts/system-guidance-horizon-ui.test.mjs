import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pages = {
  "下载和教程": source("src/app/DownloadTutorialPage.tsx"),
  "操作手册": source("src/app/ManualPage.tsx"),
  "AI 用量看板": source("src/app/AiUsageDashboardPage.tsx"),
  "部门管理": source("src/app/DepartmentManagement.tsx"),
};
const scrollReset = source("src/app/hooks/useResetPageScroll.ts");
const mobileImagePreview = source("src/app/components/MobileZoomableImage.tsx");

function sourceSection(page, startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = endMarker ? page.indexOf(endMarker, start + startMarker.length) : page.length;
  assert.ok(start >= 0 && end > start, `未找到源码区段：${startMarker}`);
  return page.slice(start, end);
}

function componentCount(page, componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

function parseTsx(page, fileName) {
  return ts.createSourceFile(fileName, page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findNode(root, predicate) {
  let match;
  const visit = (node) => {
    if (match) return;
    if (predicate(node)) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return match;
}

function findNodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function jsxTagName(opening) {
  return opening.tagName.getText(opening.getSourceFile());
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(opening.getSourceFile()) === name,
  );
}

function findJsxOpening(root, tagName, predicate = () => true) {
  return findNode(
    root,
    (node) =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTagName(node) === tagName &&
      predicate(node),
  );
}

function namedFunction(root, name) {
  const declaration = findNode(
    root,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `未找到函数：${name}`);
  return declaration;
}

function namedVariable(root, name) {
  const declaration = findNode(
    root,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name,
  );
  assert.ok(declaration, `未找到变量：${name}`);
  return declaration;
}

function callName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return call.expression.getText(call.getSourceFile());
}

test("系统指南与治理四个实现页面统一挂载 Horizon 页头和四项指标", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /horizon-theme hz-page/, `${name}应挂载 Horizon 页面根作用域`);
    assert.match(page, /<HorizonPageHeader(?:\s|>)/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid(?:\s|>)/, `${name}应使用统一 KPI 指标带`);
    assert.equal(componentCount(page, "HorizonMetric"), 4, `${name}应保持恰好四项核心指标`);
  }

  const routeImplementations = {
    "下载索引": sourceSection(pages["下载和教程"], "export function DownloadTutorialPage()", "export function PlatformTutorialPage()"),
    "下载详情": sourceSection(pages["下载和教程"], "export function PlatformTutorialPage()"),
    "手册索引": sourceSection(pages["操作手册"], "export function ManualPage()", "export function ManualTopicPage()"),
    "手册详情": sourceSection(pages["操作手册"], "export function ManualTopicPage()"),
  };
  for (const [name, implementation] of Object.entries(routeImplementations)) {
    assert.match(implementation, /horizon-theme hz-page/, `${name}应独立挂载 Horizon 页面根作用域`);
    assert.match(implementation, /<HorizonPageHeader(?:\s|>)/, `${name}应独立使用 Horizon 页头`);
  }
});

test("系统指南与治理页面不包含禁用视觉、手写全屏弹层或 MUI", () => {
  const forbiddenPatterns = [
    ["渐变", /gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["旧 Material 组件", /\bmaterial-(?:card|button|chip)\b/i],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
    ["强制视口高度", /\bh-screen\b/],
  ];

  for (const [name, page] of Object.entries(pages)) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${patternName}`);
    }
  }
});

test("下载教程保留四平台、十七步内容、路由回退与安全外链", () => {
  const downloads = pages["下载和教程"];
  const downloadsAst = parseTsx(downloads, "DownloadTutorialPage.tsx");
  const mobilePreviewAst = parseTsx(mobileImagePreview, "MobileZoomableImage.tsx");
  const configSource = downloads.slice(
    downloads.indexOf("const platformConfigs"),
    downloads.indexOf("const platforms"),
  );
  const platformIds = [...configSource.matchAll(/^    id: "([^"]+)"/gm)].map((match) => match[1]);
  const titleCount = (configSource.match(/^        title:/gm) ?? []).length;

  assert.deepEqual(platformIds, ["windows", "android", "ios", "mac"]);
  assert.equal(titleCount, 17, "四个平台应继续提供原有十七个教程步骤");
  assert.match(downloads, /const \{ platformId \} = useParams\(\)/);
  assert.match(downloads, /routePath\("page:downloads", "\/downloads"\)/);
  assert.match(downloads, /if \(!platform\) return <Navigate to=\{downloadsPath\} replace \/>/);
  assert.match(downloads, /target="_blank"/);
  assert.match(downloads, /rel="noopener noreferrer"/);
  assert.match(downloads, /aria-label=\{`\$\{action\.label\}（在新窗口打开）`\}/);
  assert.match(downloads, /copyActions: actions\.filter\(\(action\) => Object\.prototype\.hasOwnProperty\.call\(action, "value"\)\)\.length/);
  assert.match(downloads, /availableCopyActions: actions\.filter\(\(action\) => Boolean\(action\.value\?\.trim\(\)\)\)\.length/);
  assert.match(downloads, /navigator\.clipboard\.writeText\(copyValue\)/);
  assert.match(downloads, /订阅地址尚未配置，请联系管理员/);
  assert.doesNotMatch(downloads, /\$\{action\.label\} 已触发/);

  const tutorialImageSlot = namedFunction(downloadsAst, "TutorialImageSlot");
  const tutorialPreviewLink = findJsxOpening(tutorialImageSlot, "MobileImagePreviewLink");
  assert.ok(tutorialPreviewLink, "教程图片槽必须使用共享图片预览入口");
  assert.ok(jsxAttribute(tutorialPreviewLink, "src"), "教程图片预览必须绑定原图地址");
  assert.ok(jsxAttribute(tutorialPreviewLink, "alt"), "教程图片预览必须提供替代文本");
  const desktopOverride = jsxAttribute(tutorialPreviewLink, "openOnDesktop");
  if (desktopOverride?.initializer) {
    assert.ok(
      ts.isJsxExpression(desktopOverride.initializer) &&
        desktopOverride.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword,
      "教程图片若显式覆盖桌面预览，只能设为 true",
    );
  }

  const mobilePreviewFunction = namedFunction(mobilePreviewAst, "MobileImagePreviewLink");
  const desktopDefault = findNode(
    mobilePreviewFunction.parameters[0],
    (node) => ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.name.text === "openOnDesktop",
  );
  assert.ok(desktopDefault?.initializer, "共享图片预览必须声明桌面打开默认值");
  assert.equal(desktopDefault.initializer.kind, ts.SyntaxKind.TrueKeyword, "桌面图片预览默认值必须为 true");

  const previewAnchor = findJsxOpening(mobilePreviewFunction, "a");
  assert.ok(previewAnchor, "共享图片预览必须渲染语义链接");
  for (const attributeName of ["href", "target", "rel"]) {
    const attribute = jsxAttribute(previewAnchor, attributeName);
    assert.ok(attribute, `桌面图片预览链接缺少 ${attributeName}`);
    assert.match(attribute.getText(mobilePreviewAst), /openOnDesktop/, `${attributeName} 必须受桌面预览开关控制`);
  }
  assert.match(downloads, /role="status"/);
  assert.match(downloads, /aria-label="返回客户端列表"/);
});

test("下载与手册两级路由在挂载时重置共享内容区滚动位置", () => {
  assert.match(scrollReset, /pageRef\.current\?\.parentElement\?\.closest\("main"\)/);
  assert.match(scrollReset, /scrollContainer\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  for (const name of ["下载和教程", "操作手册"]) {
    assert.equal(
      (pages[name].match(/useResetPageScroll<[^>]+>\(\)/g) ?? []).length,
      2,
      `${name}的索引与详情都应重置共享内容区滚动位置`,
    );
    assert.equal((pages[name].match(/ref=\{pageRef\}/g) ?? []).length, 2);
  }
});

test("操作手册保留完整主题检索、深链目录、截图预览和语义表格", () => {
  const manual = pages["操作手册"];
  const topicSource = manual.slice(manual.indexOf("const TOPICS"), manual.indexOf("function SectionHeading"));
  const topicIds = [...topicSource.matchAll(/^    id: "([^"]+)"/gm)].map((match) => match[1]);

  assert.deepEqual(topicIds, ["cockpit", "workspace", "kb"]);
  assert.match(manual, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(manual, /topic\.points\.flatMap/);
  assert.match(manual, /topic\.howTos/);
  assert.match(manual, /topic\.deepDives/);
  assert.match(manual, /topic\.tables/);
  assert.match(manual, /topic\.faqs/);
  assert.match(manual, /id="manual-topic-search"/);
  assert.match(manual, /aria-label=\{t\("清除搜索"\)\}/);
  assert.match(manual, /onClick=\{\(\) => setQuery\(""\)\}/);
  assert.match(manual, /const \{ topicId \} = useParams\(\)/);
  assert.match(manual, /<Navigate to=\{routePath\("page:manual", "\/manual"\)\} replace \/>/);
  for (const anchor of ["tour", "howto", "deep", "tables", "faq"]) {
    assert.match(manual, new RegExp(`id: "${anchor}"`), `手册详情应保留 #${anchor} 页内深链`);
  }
  assert.match(manual, /<MobileImagePreviewLink/);
  assert.match(manual, /<caption className="sr-only">/);
  assert.match(manual, /<th key=\{col\} scope="col"/);
  assert.match(manual, /aria-label=\{t\("返回操作手册索引"\)\}/);
});

test("AI 用量看板保留读取、明细、回填、周期与分页契约", () => {
  const usage = pages["AI 用量看板"];

  for (const call of ["fetchAiUsageDashboard", "fetchAiUsageDetails", "backfillAiUsage"]) {
    assert.match(usage, new RegExp(`${call}\\(`), `AI 用量看板缺少 ${call} 调用链`);
  }
  assert.match(usage, /aria-pressed=\{range === item\.value\}/);
  assert.match(usage, /setModelPage\(1\)/);
  assert.match(usage, /setUserPage\(1\)/);
  assert.match(usage, /getUsageRankingPage\(modelRows\.length, modelPage\)/);
  assert.match(usage, /getUsageRankingPage\(userRows\.length, userPage\)/);
  assert.match(usage, /<caption className="sr-only">按人员统计的 AI 使用排行榜/);
  assert.equal((usage.match(/<th scope="col"/g) ?? []).length, 9, "人员排行应保留九列表头语义");
  assert.match(usage, /tabIndex=\{0\}/);
  assert.match(usage, /onKeyDown=\{\(event\) =>/);
  assert.match(usage, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(usage, /<SheetContent[\s\S]{0,160}?className="horizon-portal/);
  assert.match(usage, /const detailTriggerRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(usage, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(usage, /if \(trigger\?\.isConnected\) trigger\.focus\(\)/);
});

test("部门管理保留目录 API、权限、分页、表单校验与安全删除确认", () => {
  const departments = pages["部门管理"];
  const departmentsAst = parseTsx(departments, "DepartmentManagement.tsx");

  for (const call of [
    "apiListDepartments",
    "apiSaveDepartment",
    "apiUpdateDepartmentStatus",
    "apiDeleteDepartment",
  ]) {
    assert.match(departments, new RegExp(`${call}\\(`), `部门管理缺少 ${call} 调用链`);
  }
  for (const permission of ["department:create", "department:edit", "department:delete"]) {
    assert.match(departments, new RegExp(`permission="${permission}"`), `部门管理缺少 ${permission} 权限边界`);
  }
  assert.match(departments, /<caption className="sr-only">部门名称、分类、负责人、用户数量、排序、状态及可用操作<\/caption>/);
  assert.match(departments, /<th key=\{col\} scope="col"/);
  assert.match(departments, /const PAGE_SIZE = 10/);
  assert.match(departments, /const safePage = Math\.min\(page, totalPages\)/);
  assert.match(departments, /filteredDepartments\.slice\(\(safePage - 1\) \* PAGE_SIZE, safePage \* PAGE_SIZE\)/);
  assert.match(departments, /if \(page !== safePage\) setPage\(safePage\)/);

  const statusGuardOpening = findJsxOpening(
    departmentsAst,
    "PermissionGuard",
    (opening) =>
      jsxAttribute(opening, "anyOf")?.getText(departmentsAst).includes('"department:edit"') &&
      jsxAttribute(opening, "anyOf")?.getText(departmentsAst).includes('"rd-people:manage"'),
  );
  assert.ok(statusGuardOpening, "状态切换必须受与服务端一致的编辑权限保护");
  assert.ok(ts.isJsxElement(statusGuardOpening.parent), "状态权限守卫必须包裹实际状态控件");

  const fallbackAttribute = jsxAttribute(statusGuardOpening, "fallback");
  assert.ok(fallbackAttribute, "无状态编辑权限时必须提供只读状态 fallback");
  const fallbackStatus = findJsxOpening(fallbackAttribute, "span");
  assert.ok(fallbackStatus, "状态 fallback 必须为非交互文本");
  assert.ok(jsxAttribute(fallbackStatus, "aria-label")?.getText(departmentsAst).includes("部门状态"), "只读状态必须提供可访问名称");
  for (const interactiveAttribute of ["onClick", "role", "tabIndex"]) {
    assert.equal(jsxAttribute(fallbackStatus, interactiveAttribute), undefined, `只读状态不得包含 ${interactiveAttribute}`);
  }
  for (const interactiveElement of ["button", "a", "input", "Switch"]) {
    assert.equal(findJsxOpening(fallbackAttribute, interactiveElement), undefined, `只读状态不得包含 ${interactiveElement} 控件`);
  }

  const guardedToggle = findJsxOpening(
    statusGuardOpening.parent,
    "Button",
    (opening) => jsxAttribute(opening, "onClick")?.getText(departmentsAst).includes("handleToggleStatus(department)"),
  );
  assert.ok(guardedToggle, "状态切换按钮必须实际嵌套在权限守卫内");

  const loadDepartments = namedVariable(departmentsAst, "loadDepartments");
  assert.ok(loadDepartments.initializer, "部门读取流程必须有初始化实现");
  const loadCallNames = findNodes(loadDepartments.initializer, ts.isCallExpression).map(callName);
  assert.ok(loadCallNames.includes("apiListDepartments"), "部门读取流程必须调用列表 API");
  assert.ok(loadCallNames.includes("setDepartments"), "部门读取流程必须回填列表状态");
  assert.deepEqual(
    [...new Set(loadCallNames.filter((name) => /^api[A-Z]/.test(name) && name !== "apiListDepartments"))],
    [],
    "列表读取路径不得调用列表 API 以外的业务接口",
  );

  const mutatingApiNames = findNodes(
    departmentsAst,
    (node) =>
      ts.isFunctionDeclaration(node) &&
      Boolean(node.name?.text.startsWith("api")) &&
      /\bmethod\s*:\s*["'`](?:POST|PUT|PATCH|DELETE)["'`]/i.test(node.getText(departmentsAst)),
  ).map((declaration) => declaration.name.text);
  for (const mutationName of mutatingApiNames) {
    assert.equal(loadCallNames.includes(mutationName), false, `列表读取路径不得调用写入 API：${mutationName}`);
  }
  for (const directRequest of ["authFetch", "fetch"]) {
    assert.equal(loadCallNames.includes(directRequest), false, `列表读取路径不得绕过列表 API 直接调用 ${directRequest}`);
  }
  assert.match(departments, /publishDepartmentChange\(change\);[\s\S]{0,80}?clearPendingDepartmentChange\(change\)/);
  assert.match(departments, /<DialogContent[\s\S]{0,220}?horizon-portal/);
  assert.match(departments, /<AlertDialogContent[\s\S]{0,220}?horizon-portal/);
  assert.equal((departments.match(/onCloseAutoFocus=/g) ?? []).length, 2, "编辑和删除弹层都应恢复触发按钮焦点");
  assert.equal((departments.match(/aria-invalid=\{Boolean\(formErrors\./g) ?? []).length, 3, "三个必填项都应提供就地校验");
  assert.match(departments, /document\.getElementById\(firstInvalidId\)\?\.focus\(\)/);
  assert.match(departments, /disabled=\{saving \|\| \(selectedDepartment\?\.userCount \?\? 0\) > 0\}/);
  assert.match(departments, /role="alert"/);
});
