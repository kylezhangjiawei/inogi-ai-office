import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function componentCount(page, componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

const pages = {
  "用户管理": source("src/app/UserManagement.tsx"),
  "角色权限": source("src/app/RoleManagement.tsx"),
  "页面路由管理": source("src/app/RouteManagementPage.tsx"),
  "字典列表": source("src/app/DictionaryList.tsx"),
};

// Execute the page's real save request with controlled HTTP responses.
const userSource = ts.createSourceFile("UserManagement.tsx", pages["用户管理"], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const saveFunctions = userSource.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && ["apiSaveUser", "readUserSaveError"].includes(statement.name?.text))
  .map((statement) => statement.getText(userSource))
  .join("\n");
const createSaveUser = new Function("authFetch", "translate", `${ts.transpileModule(saveFunctions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText}\nreturn apiSaveUser;`);
const userForm = { name: "测试用户", englishName: "", username: "duplicate", department: "研发部", roleId: "role-1", status: "ACTIVE", password: "test-password" };

test("保存用户按错误类型展示中文提示，避免直接展示英文 Error", async () => {
  const cases = [
    [409, { code: "USERNAME_ALREADY_EXISTS", message: "Error" }, "用户名已存在，请更换用户名"],
    [409, { code: "EMAIL_ALREADY_EXISTS", message: "Conflict" }, "邮箱已被使用，请更换邮箱"],
    [400, { message: ["姓名不能超过 80 个字符", "密码长度至少 8 位"] }, "姓名不能超过 80 个字符；密码长度至少 8 位"],
    [400, { message: "指定的角色不存在，可能已被删除，请重新选择" }, "指定的角色不存在，可能已被删除，请重新选择"],
    [401, { message: "Unauthorized" }, "登录已失效，请重新登录后再试"],
    [403, { message: "Forbidden resource" }, "没有保存用户的权限，请联系管理员"],
    [403, { message: "超级管理员账号信息不允许修改" }, "超级管理员账号信息不允许修改"],
    [404, { message: "Not Found" }, "用户不存在或已被删除，请刷新列表后重试"],
    [409, { message: "Conflict" }, "用户名或邮箱已被使用，请检查后重试"],
    [429, { message: "ThrottlerException: Too Many Requests" }, "操作过于频繁，请稍后再试"],
    [500, { message: "Internal server error", detail: "private database detail" }, "服务器暂时无法保存用户，请稍后重试"],
    [502, null, "服务器暂时无法保存用户，请稍后重试"],
    [400, { message: "Error" }, "用户信息有误，请检查填写内容后重试"],
    [400, { message: [null, {}, ""] }, "用户信息有误，请检查填写内容后重试"],
    [418, {}, "保存用户失败，请稍后重试"],
  ];
  for (const [status, body, expected] of cases) {
    const save = createSaveUser(async () => new Response(JSON.stringify(body), { status }), (text) => text);
    await assert.rejects(() => save(userForm), { message: expected }, `${status}: ${JSON.stringify(body)}`);
  }
});

test("保存用户处理网络断开和非 JSON 错误响应，且不自动重复提交", async () => {
  let attempts = 0;
  const save = createSaveUser(async () => { attempts += 1; throw new TypeError("Failed to fetch"); }, (text) => text);
  await assert.rejects(() => save(userForm), { message: "网络连接异常，请检查网络后重试" });
  assert.equal(attempts, 1);
  const gatewaySave = createSaveUser(async () => new Response("<html>Bad Gateway</html>", { status: 502 }), (text) => text);
  await assert.rejects(() => gatewaySave(userForm), { message: "服务器暂时无法保存用户，请稍后重试" });
});

test("保存用户成功时保持创建和编辑请求契约", async () => {
  for (const id of [undefined, "user-1"]) {
    const saved = { id: id ?? "created-user", name: userForm.name };
    const calls = [];
    const save = createSaveUser(async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(saved), { status: 201 });
    }, (text) => text);
    assert.deepEqual(await save({ ...userForm, id }), saved);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/users");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].body.username, userForm.username);
    assert.equal(calls[0].body.id, id);
    assert.equal(calls[0].body.password, id ? undefined : userForm.password);
  }
});

const roleSource = ts.createSourceFile("RoleManagement.tsx", pages["角色权限"], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const roleFunctions = roleSource.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && ["apiListRoles", "apiSaveRole", "apiDeleteRole", "readRoleError"].includes(statement.name?.text))
  .map((statement) => statement.getText(roleSource))
  .join("\n");
const createRoleApi = new Function("authFetch", `${ts.transpileModule(roleFunctions, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText}\nreturn { list: apiListRoles, save: apiSaveRole, remove: apiDeleteRole };`);
const roleForm = { name: "项目成员", description: "说明", permissions: ["page:tasks"] };

test("角色保存按重复、校验、权限、缺失与服务异常分类显示中文", async () => {
  const cases = [
    [409, { code: "ROLE_NAME_ALREADY_EXISTS", message: "Error" }, "角色名称已存在，请更换名称"],
    [400, { message: ["角色名称不能为空", "权限项必须是字符串"] }, "角色名称不能为空；权限项必须是字符串"],
    [400, { message: "Error" }, "角色信息有误，请检查填写内容后重试"],
    [401, { message: "Unauthorized" }, "登录已失效，请重新登录后再试"],
    [403, { message: "Forbidden resource" }, "没有保存角色的权限，请联系管理员"],
    [403, { message: "不能管理或授予超出当前账号权限范围的角色，请联系超级管理员" }, "不能管理或授予超出当前账号权限范围的角色，请联系超级管理员"],
    [403, { message: "超级管理员角色不允许修改" }, "超级管理员角色不允许修改"],
    [404, { message: "Not Found" }, "角色不存在或已被删除，请刷新列表后重试"],
    [429, { message: "Too Many Requests" }, "操作过于频繁，请稍后再试"],
    [500, { message: "数据库详情不能显示" }, "服务器暂时无法保存角色，请稍后重试"],
  ];
  for (const [status, body, expected] of cases) {
    const api = createRoleApi(async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(() => api.save(roleForm), { message: expected });
  }
});

test("角色读取、保存、删除的断网均显示中文且写入不重复请求", async () => {
  for (const action of ["list", "save", "remove"]) {
    let attempts = 0;
    const api = createRoleApi(async () => { attempts += 1; throw new TypeError("Failed to fetch"); });
    await assert.rejects(() => api[action](action === "save" ? roleForm : "role-1"), { message: "网络连接异常，请检查网络后重试" });
    assert.equal(attempts, 1);
  }
  const api = createRoleApi(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(() => api.save(roleForm), { message: "服务器暂时无法保存角色，请稍后重试" });
});

test("角色创建编辑保持请求契约，成功响应仍返回保存对象", async () => {
  for (const id of [undefined, "existing-role"]) {
    const calls = [];
    const saved = { ...roleForm, id: id ?? "created-role" };
    const api = createRoleApi(async (url, init) => {
      calls.push({ url, method: init.method, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(saved), { status: 201 });
    });
    assert.deepEqual(await api.save({ ...roleForm, id }), saved);
    assert.deepEqual(calls, [{ url: "/api/roles", method: "POST", body: { ...roleForm, ...(id ? { id } : {}) } }]);
  }
});

test("系统管理四个核心页面统一挂载 Horizon 页头和四项指标", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面根作用域`);
    assert.match(page, /<HorizonPageHeader(?:\s|>)/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid(?:\s|>)/, `${name}应使用统一指标带`);
    assert.equal(componentCount(page, "HorizonMetric"), 4, `${name}应保持恰好四项核心指标`);
  }
});

test("系统管理四页不包含禁用视觉、手写弹层、原生确认或 MUI", () => {
  const forbiddenPatterns = [
    ["渐变", /gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["旧 Material 组件", /\bmaterial-(?:card|button|chip|input)\b/i],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
    ["原生确认框", /window\.confirm\s*\(/],
    ["固定视口高度", /\bh-screen\b/],
  ];

  for (const [name, page] of Object.entries(pages)) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${patternName}`);
    }
  }
});

test("用户管理保留身份目录 API、权限边界和安全分页", () => {
  const users = pages["用户管理"];

  for (const call of [
    "apiListUsers",
    "apiListRoles",
    "apiListDepartments",
    "apiSaveUser",
    "apiUpdateStatus",
    "apiResetPassword",
    "apiDeleteUser",
  ]) {
    assert.match(users, new RegExp(`${call}\\(`), `用户管理缺少 ${call} 调用链`);
  }
  for (const permission of ["user:create", "user:edit", "user:disable", "user:delete"]) {
    assert.match(users, new RegExp(`permission="${permission}"`), `用户管理缺少 ${permission} 权限边界`);
  }
  assert.match(users, /const PAGE_SIZE = 10/);
  assert.match(users, /const safePage = Math\.min\(page, totalPages\)/);
  assert.match(users, /filteredUsers\.slice\(\(safePage - 1\) \* PAGE_SIZE, safePage \* PAGE_SIZE\)/);
  assert.match(users, /if \(page !== safePage\) setPage\(safePage\)/);
  assert.match(users, /function isSuperAdmin\(user: User\)/);
  assert.match(
    users,
    /permission === ["']\*["'] \|\| permission === (?:PERMISSIONS\.USER_RESET_PASSWORD|["']user:reset-password["'])/,
  );
  assert.match(users, /const canChange = isSelf \|\| \(!isSuperAdmin\(user\) && canResetOtherUsers\)/);
  assert.match(users, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(users, /if \(requestId !== loadRequestRef\.current\) return/);
  assert.match(users, /if \(requestId === loadRequestRef\.current\) setLoading\(false\)/);
});

test("用户目录使用语义表格、标准弹层、就地校验与焦点恢复", () => {
  const users = pages["用户管理"];

  assert.match(users, /<caption className="sr-only">/);
  assert.match(users, /<th key=\{column\} scope="col"/);
  assert.match(users, /aria-label=\{t\("编辑用户 \{name\}"/);
  assert.match(users, /aria-label=\{t\("删除用户 \{name\}"/);
  assert.match(users, /<DialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.match(users, /<AlertDialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.equal((users.match(/onCloseAutoFocus=/g) ?? []).length, 3, "用户编辑、密码和删除弹层都应恢复焦点");
  assert.match(users, /aria-invalid=\{Boolean\(formErrors\.name\)\}/);
  assert.match(users, /aria-invalid=\{Boolean\(formErrors\.password\)\}/);
  assert.match(users, /aria-invalid=\{Boolean\(newPasswordError\)\}/);
  assert.match(users, /ariaInvalid=\{Boolean\(formErrors\.department\)\}/);
  assert.match(users, /ariaDescribedBy=\{formErrors\.department \? "user-department-error" : "user-department-help"\}/);
  assert.match(users, /ariaInvalid=\{Boolean\(formErrors\.roleId\)\}/);
  assert.match(users, /ariaDescribedBy=\{formErrors\.roleId \? "user-role-error" : "user-role-help"\}/);
  assert.match(users, /if \(!form\.id && !form\.department\.trim\(\)\) nextErrors\.department/);
  assert.match(users, /if \(!form\.id && !form\.roleId\) nextErrors\.roleId/);
  assert.match(users, /document\.getElementById\("user-department"\)\?\.focus\(\)/);
  assert.match(users, /document\.getElementById\("user-role"\)\?\.focus\(\)/);
  assert.doesNotMatch(users, /暂不分配/);
  assert.match(users, /当前未分配（保存时保持）/);
  assert.match(users, /requestAnimationFrame\(\(\) =>/);
  assert.match(users, /<AlertDialogTitle[^>]*>\{t\("确认删除用户？"\)\}<\/AlertDialogTitle>/);
});

test("角色权限保留角色与权限目录 API、快速授权回滚和权限守卫", () => {
  const roles = pages["角色权限"];

  for (const call of ["apiListRoles", "apiSaveRole", "apiDeleteRole", "permissionCatalogApi.listGroups"]) {
    assert.match(roles, new RegExp(call.replace(".", "\\.") + "\\("), `角色权限缺少 ${call} 调用链`);
  }
  assert.match(roles, /async function handleQuickSavePermissions\(role: Role, permissions: string\[\]\)/);
  assert.match(roles, /item\.id === role\.id \? \{ \.\.\.item, permissions: role\.permissions \} : item/);
  assert.match(roles, /const requestId = \+\+rolesRequestRef\.current/);
  assert.match(roles, /if \(requestId !== rolesRequestRef\.current\) return;/);
  assert.match(roles, /function invalidatePendingRoleLoads\(\)/);
  const quickPermissionSave = roles.slice(
    roles.indexOf("async function handleQuickSavePermissions"),
    roles.indexOf("async function handleDeleteRole"),
  );
  assert.match(quickPermissionSave, /invalidatePendingRoleLoads\(\)[\s\S]*?await apiSaveRole/);
  assert.match(quickPermissionSave, /toast\.success\("权限已保存"\);\s+await loadRoles\(\);/);
  assert.match(roles, /<PermissionGuard[\s\S]{0,180}?permission="role:edit"[\s\S]{0,220}?fallback=/);
  assert.match(roles, /disabled=\{permissionSavingRoleId === activeRole\.id\}/);
  assert.match(roles, /const safePage = Math\.min\(page, totalPages\)/);
  assert.match(roles, /filteredRoles\.slice\([\s\S]{0,100}?ROLE_PAGE_SIZE/);
  assert.match(roles, /<ul className="space-y-2" aria-label="角色列表">/);
});

test("角色新增编辑删除采用标准弹层并提供安全删除和表单校验", () => {
  const roles = pages["角色权限"];

  assert.match(roles, /<DialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.match(roles, /<AlertDialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.equal((roles.match(/onCloseAutoFocus=/g) ?? []).length, 2);
  assert.match(roles, /aria-invalid=\{Boolean\(formErrors\.name\)\}/);
  assert.match(roles, /document\.getElementById\("role-name"\)\?\.focus\(\)/);
  assert.match(roles, /disabled=\{saving \|\| \(selectedRole\?\._count\?\.users \?\? 0\) > 0\}/);
  assert.match(roles, /<AlertDialogTitle[^>]*>确认删除角色？<\/AlertDialogTitle>/);
});

test("页面路由管理保留目录读写、缓存更新、导航显隐和路径校验", () => {
  const routes = pages["页面路由管理"];

  for (const call of [
    "permissionCatalogApi.listItems",
    "permissionCatalogApi.saveItem",
    "permissionCatalogApi.deleteItem",
    "cacheRoutePaths",
  ]) {
    assert.match(routes, new RegExp(call.replace(".", "\\.") + "\\("), `页面路由管理缺少 ${call} 调用链`);
  }
  assert.match(routes, /async function handleToggleNavHidden\(item: PermissionCatalogItem\)/);
  assert.match(routes, /navHidden: !item\.navHidden/);
  assert.match(routes, /const requestId = \+\+itemsRequestRef\.current/);
  assert.match(routes, /if \(requestId !== itemsRequestRef\.current\) return null;/);
  assert.match(routes, /function beginItemWrite\(itemId\?: string\)/);
  assert.match(routes, /if \(itemId && busyItemIdsRef\.current\.has\(itemId\)\) return false;/);
  assert.equal((routes.match(/if \(!beginItemWrite\(busyItemId\)\)/g) ?? []).length, 2);
  assert.match(routes, /if \(!beginItemWrite\(item\.id\)\) return;/);
  assert.match(routes, /item\.id !== form\.id && item\.code\.toLowerCase\(\) === code\.toLowerCase\(\)/);
  assert.match(routes, /if \(!routePath\) errors\.routePath/);
  assert.match(routes, /else if \(!routePath\.startsWith\("\/"\)\)/);
  assert.match(routes, /routePath\.includes\("\*"\)/);
  assert.match(routes, /item\.routePath\.trim\(\) === routePath/);
  assert.match(routes, /focusFirstInvalidField\(errors\)/);
});

test("页面路由目录使用可展开语义表格和标准编辑删除弹层", () => {
  const routes = pages["页面路由管理"];

  assert.match(routes, /aria-expanded=\{rootExpanded\}/);
  assert.match(routes, /aria-controls=\{rootPanelId\}/);
  assert.match(routes, /<caption className="sr-only">\{root\.label\}中的\{branch\.label\}权限项<\/caption>/);
  assert.match(routes, /<th key=\{column\} scope="col"/);
  assert.match(routes, /aria-label=\{`\$\{item\.navHidden \? "显示" : "隐藏"\}/);
  assert.match(routes, /<DialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.match(routes, /<AlertDialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.equal((routes.match(/onCloseAutoFocus=/g) ?? []).length, 2);
  assert.match(routes, /disabled=\{itemBusy\} onClick=\{\(event\) => openEdit/);
  assert.match(routes, /disabled=\{Boolean\(item\.builtIn\) \|\| itemBusy\}/);
});

test("字典列表保留类型与条目 API、请求防串页和安全分页", () => {
  const dictionaries = pages["字典列表"];

  for (const call of [
    "dictionaryApi.listTypes",
    "dictionaryApi.saveType",
    "dictionaryApi.deleteType",
    "dictionaryApi.listItems",
    "dictionaryApi.saveItem",
    "dictionaryApi.deleteItem",
  ]) {
    assert.match(dictionaries, new RegExp(call.replace(".", "\\.") + "\\("), `字典列表缺少 ${call} 调用链`);
  }
  assert.match(dictionaries, /const requestId = \+\+typesRequestRef\.current/);
  assert.match(dictionaries, /if \(requestId !== typesRequestRef\.current\) return/);
  assert.match(dictionaries, /const requestId = \+\+itemsRequestRef\.current/);
  assert.match(dictionaries, /if \(requestId !== itemsRequestRef\.current\) return/);
  assert.match(dictionaries, /const safeTotalPages = Math\.max\(1, totalPages\)/);
  assert.match(dictionaries, /const safePage = Math\.min\(page, safeTotalPages\)/);
  assert.match(dictionaries, /if \(page !== safePage\) setPage\(safePage\)/);
});

test("字典类型和条目使用语义控件、标准弹层与就地错误", () => {
  const dictionaries = pages["字典列表"];

  assert.match(dictionaries, /aria-pressed=\{activeTypeId === type\.id\}/);
  assert.match(dictionaries, /<caption className="sr-only">\{activeType\.label\}邮箱账号列表<\/caption>/);
  assert.match(dictionaries, /<caption className="sr-only">\{activeType\.label\}通用字典条目列表<\/caption>/);
  assert.equal((dictionaries.match(/<th scope="col"/g) ?? []).length, 11);
  assert.match(dictionaries, /aria-pressed=\{Boolean\(showPwd\[row\.id\]\)\}/);
  assert.match(dictionaries, /<DialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.match(dictionaries, /<AlertDialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.equal((dictionaries.match(/onCloseAutoFocus=/g) ?? []).length, 2);
  assert.match(dictionaries, /dialogTriggerRef\.current = stableTypeFocusRef\.current/);
  assert.match(dictionaries, /dialogTriggerRef\.current = stableItemFocusRef\.current/);
  assert.match(dictionaries, /ref=\{stableTypeFocusRef\}/);
  assert.match(dictionaries, /ref=\{stableItemFocusRef\}/);
  for (const field of ["typeLabel", "account", "password", "code", "label"]) {
    assert.match(dictionaries, new RegExp(`aria-invalid=\\{Boolean\\(formErrors\\.${field}\\)\\}`), `字典表单缺少 ${field} 就地校验`);
  }
  assert.match(dictionaries, /window\.requestAnimationFrame\(\(\) => first\?\.\[1\]\.current\?\.focus\(\)\)/);
});
