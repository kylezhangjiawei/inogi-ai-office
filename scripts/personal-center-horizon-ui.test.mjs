import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/PersonalCenterPage.tsx", import.meta.url), "utf8");

function componentCount(componentName) {
  return (page.match(new RegExp(`<${componentName}(?=[\\s>])`, "g")) ?? []).length;
}

test("个人中心使用统一 Horizon 页面结构和恰好四项真实指标", () => {
  assert.match(page, /<main className="horizon-theme hz-page/);
  assert.equal(componentCount("HorizonPageHeader"), 1);
  assert.equal(componentCount("HorizonMetricGrid"), 1);
  assert.equal(componentCount("HorizonMetric"), 4);
  for (const label of ["登录账号", "账号角色", "权限范围", "资料与安全"]) {
    assert.match(page, new RegExp(`label="${label}"`));
  }
  for (const value of ["user?.username", "roleLabel", "permissionSummary", "isSuperAdmin", "user?.hasCustomAvatar"]) {
    assert.match(page, new RegExp(value.replace(/[?.]/g, (character) => `\\${character}`)));
  }
});

test("个人资料、密码与头像 API 契约保持完整", () => {
  for (const endpoint of [
    '"/api/auth/me"',
    '"/api/auth/me/avatar"',
    '"/api/auth/avatar-presets"',
    '"/api/auth/me/avatar/preset"',
    '"/api/auth/me/password"',
  ]) {
    assert.match(page, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /method: "DELETE"/);
  assert.equal((page.match(/method: "POST"/g) ?? []).length, 3);
  assert.match(page, /clearStoredUserAvatar\(user\.id\)/);
  assert.match(page, /await refreshUser\(\)/);
  assert.match(page, /await resetMyAvatar\(\)/);
});

test("超级管理员字段锁定和本人可编辑策略保持不变", () => {
  assert.match(page, /const isSuperAdmin = Boolean\(user\?\.permissions\.includes\("\*"\)\)/);
  assert.match(page, /const canEditAccountFields = Boolean\(user\) && !isSuperAdmin/);
  assert.match(page, /const canEditEnglishName = Boolean\(user\)/);
  assert.match(page, /email: user\.permissions\.includes\("\*"\) \? user\.email : nextEmail/);
  assert.match(page, /disabled=\{!canEditAccountFields \|\| savingPassword\}/);
  assert.match(page, /超级管理员可修改头像和英文名/);
  assert.match(page, /超级管理员密码在个人中心保持锁定/);
});

test("头像选择使用标准 Dialog、懒加载和焦点恢复", () => {
  assert.match(page, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
  assert.match(page, /<DialogContent[\s\S]{0,180}?className="horizon-portal/);
  assert.match(page, /onCloseAutoFocus=\{\(event\) =>/);
  assert.match(page, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(page, /if \(open && tab === "gallery" && !loadedRef\.current\) loadPresets\(\)/);
  assert.match(page, /role="tablist" aria-label="头像来源"/);
  assert.equal((page.match(/role="tab"/g) ?? []).length, 2);
  assert.equal((page.match(/role="tabpanel"/g) ?? []).length, 2);
  assert.match(page, /aria-label=\{`选择默认头像 \$\{index \+ 1\}`\}/);
  assert.match(page, /actionError[\s\S]{0,180}?role="alert"/);
  assert.doesNotMatch(page, /fixed\s+inset-0/);
});

test("资料与密码表单提供就地错误、显隐语义和首错聚焦", () => {
  for (const field of ["englishName", "email", "oldPassword", "password"]) {
    assert.match(page, new RegExp(`aria-invalid=\\{Boolean\\([^)]*${field}`));
  }
  assert.match(page, /aria-invalid=\{Boolean\(confirmPasswordError\)\}/);
  assert.match(page, /<FieldError id="profile-email-error">/);
  assert.match(page, /<FieldError id="profile-old-password-error">/);
  assert.match(page, /<FieldError id="profile-password-error">/);
  assert.match(page, /<FieldError id="profile-password-confirm-error">/);
  assert.match(page, /englishNameRef\.current : emailRef\.current\)\?\.focus\(\)/);
  assert.match(page, /oldPasswordRef\.current\?\.focus\(\)/);
  assert.match(page, /newPasswordRef\.current\?\.focus\(\)/);
  assert.match(page, /confirmPasswordRef\.current\?\.focus\(\)/);
  assert.equal((page.match(/aria-pressed=\{show/g) ?? []).length, 2);
  assert.match(page, /role="meter" aria-label=\{`密码强度：\$\{pwdStrength\.label\}`\}/);
});

test("个人中心保持窄宽响应式与清晰的信息层级", () => {
  assert.match(page, /max-w-\[1600px\].*min-w-0/);
  assert.match(page, /sm:flex-row sm:items-center/);
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(280px,0\.45fr\)\]/);
  assert.match(page, /grid min-w-0 gap-4 lg:grid-cols-2/);
  for (const label of ["身份概览", "个人资料", "密码安全"]) assert.match(page, new RegExp(label));
});

test("个人中心不含旧视觉、动画炫技和手写弹层", () => {
  const forbidden = [
    ["渐变", /gradient/i],
    ["炫光", /\b(?:shimmer|glow)\b/i],
    ["紫色旧品牌", /\b(?:purple|violet|fuchsia|indigo)-/i],
    ["装饰字距", /\btracking-/],
    ["大写装饰", /\buppercase\b/],
    ["悬停位移", /(?:hover|group-hover):-?translate/],
    ["全属性过渡", /\btransition-all\b/],
    ["Motion 动画", /motion(?:\/react|\.)/],
    ["旧 Material 组件", /\bmaterial-(?:card|button|chip|input)\b/i],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
    ["固定视口高度", /\bh-screen\b/],
  ];
  for (const [name, pattern] of forbidden) assert.doesNotMatch(page, pattern, `不应包含${name}`);
});
