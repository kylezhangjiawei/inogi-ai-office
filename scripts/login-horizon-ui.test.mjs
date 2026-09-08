import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/LoginPage.tsx", import.meta.url), "utf8");
const recordFooter = readFileSync(
  new URL("../src/app/components/SiteRecordFooter.tsx", import.meta.url),
  "utf8",
);

test("登录入口保持仓库原有品牌视觉", () => {
  assert.match(
    page,
    /const DEFAULT_LOGIN_BG = "https:\/\/matechat\.gitcode\.com\/png\/home\/bgHome\.png"/,
  );
  assert.match(
    page,
    /className="flex min-h-\[100dvh\] flex-col items-center bg-center bg-cover bg-no-repeat px-4 py-6"/,
  );
  assert.match(
    page,
    /max-w-sm[\s\S]{0,160}bg-white\/80[\s\S]{0,120}backdrop-blur-md/,
  );
  assert.match(
    page,
    /bg-\[linear-gradient\(145deg,#4338ca_0%,#6366f1_55%,#a5b4fc_100%\)\]/,
  );
  assert.match(page, /INOGI AI Office System/);
  assert.match(page, /内部管理系统一体化工作台/);
  assert.match(page, /登录 INOGI 系统/);
  assert.equal((page.match(/className="material-input/g) ?? []).length, 2);
  assert.match(page, /\bmaterial-button-primary\b/);
  assert.match(
    page,
    /<SiteRecordFooter className="mt-4 w-full max-w-5xl" \/>/,
  );
  assert.match(recordFooter, /tone = "light"/);
  assert.match(recordFooter, /hover:text-indigo-600 focus-visible:ring-indigo-300/);

  for (const obsoleteHorizonPattern of [
    /horizon-theme/,
    /Horizon 工作台/,
    /一个入口，连接跨部门协作/,
    /<SiteRecordFooter tone="dark"/,
    /bg-\[#0b2142\]/,
  ]) {
    assert.doesNotMatch(page, obsoleteHorizonPattern);
  }
});

test("登录 API、动态运营背景与安全跳转契约保持不变", () => {
  assert.match(page, /authFetch\("\/api\/content-slots\/public\/login-background"\)/);
  assert.match(page, /login\(\{ account: account\.trim\(\), password \}\)/);
  assert.match(page, /from && from !== "\/login" \? from : "\/"/);
  assert.match(page, /navigate\(redirectTo, \{ replace: true \}\)/);
  assert.match(page, /root\.classList\.add\("login-route"\)/);
  assert.match(page, /root\.classList\.remove\("login-route"\)/);
  assert.match(page, /backgroundImage: `url\(\$\{bgUrl\}\)`/);
  assert.match(page, /if \(!hydrated\) return null/);
});

test("原有登录表单继续满足移动端输入与安全区约束", () => {
  assert.match(page, /autoComplete="username"/);
  assert.match(page, /autoComplete="current-password"/);
  assert.match(page, /autoCapitalize="none"/);
  assert.match(page, /autoCorrect="off"/);
  assert.match(page, /aria-pressed=\{showPassword\}/);
  assert.match(page, /role="alert"/);
  assert.equal((page.match(/min-h-\[48px\]/g) ?? []).length, 3);
  assert.equal((page.match(/text-base[^"\n]*lg:text-sm/g) ?? []).length, 3);
  assert.match(page, /env\(safe-area-inset-left\)/);
  assert.match(page, /env\(safe-area-inset-right\)/);
  assert.match(page, /env\(safe-area-inset-top\)/);
  assert.match(page, /env\(safe-area-inset-bottom\)/);
});
