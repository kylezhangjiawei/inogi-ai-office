import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/app/MobileShell.tsx", import.meta.url), "utf8");

test("移动壳层使用 Horizon 与单一 Klein Blue 视觉语言", () => {
  assert.match(shell, /className="horizon-theme hz-page min-h-\[100dvh\]/);
  assert.match(shell, /bg-\[#002fa7\]/);
  assert.match(shell, /text-\[#002fa7\]/);
  assert.match(shell, /bg-\[#eef3ff\]/);

  const forbidden = [
    [/gradient/i, "渐变"],
    [/\b(?:indigo|purple|violet|fuchsia|pink)-/i, "紫粉与旧靛色"],
    [/\bh-screen\b/, "固定视口高度"],
    [/\btransition-all\b|(?:hover|group-hover):-?translate/, "全属性过渡或悬停位移"],
    [/\btracking-|\buppercase\b/, "装饰性字距"],
  ];
  for (const [pattern, label] of forbidden) assert.doesNotMatch(shell, pattern, `不应包含${label}`);
});

test("移动菜单使用标准 Sheet，焦点、Escape 和滚动锁不再手写", () => {
  for (const component of ["Sheet", "SheetTrigger", "SheetContent", "SheetHeader", "SheetTitle", "SheetDescription", "SheetClose"]) {
    assert.match(shell, new RegExp(`<${component}(?=[\\s>])`), `缺少 ${component}`);
  }
  assert.match(shell, /<Sheet open=\{menuOpen\} onOpenChange=\{handleMenuOpenChange\}>/);
  assert.match(shell, /<SheetTrigger asChild>[\s\S]{0,180}?aria-label="打开菜单"/);
  assert.match(shell, /<SheetContent[\s\S]{0,300}?id="mobile-shell-navigation"[\s\S]{0,300}?horizon-portal/);
  assert.match(shell, /aria-haspopup="dialog"/);
  assert.match(shell, /aria-expanded=\{menuOpen\}/);
  assert.match(shell, /aria-controls="mobile-shell-navigation"/);
  assert.doesNotMatch(shell, /fixed\s+inset-0/);
  assert.doesNotMatch(shell, /document\.addEventListener\(["']keydown/);
  assert.doesNotMatch(shell, /useBodyScrollLock|activeElement|\.focus\(\)/);
});

test("顶部、菜单和备案底栏覆盖安全区且所有操作目标至少 44px", () => {
  assert.match(shell, /pt-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\]/);
  assert.match(shell, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(shell, /<SiteRecordFooter className="pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\] backdrop-blur-none" \/>/);
  assert.match(shell, /\[&_a\]:min-h-11/);
  assert.match(shell, /aria-label="打开菜单"[\s\S]{0,260}?className="[^"]*size-11/);
  assert.match(shell, /aria-label="关闭菜单"[\s\S]{0,180}?className="[^"]*size-11/);
  assert.ok((shell.match(/min-h-12/g) ?? []).length >= 3, "导航与退出操作均需至少 48px 高");
  assert.doesNotMatch(shell, /className="[^"]*\bh-(?:8|9|10)\b[^"]*"[^>]*aria-label=/);
});

test("研发、协同、生产与分析路由出口和权限边界保持不变", () => {
  for (const contract of [
    /isProductionWorkspace\(\)/,
    /location\.pathname\.startsWith\("\/us-collab-m"\)/,
    /const cockpitPath = returnsToUsCollab \? "\/us-collab-m" : isProduction \? "\/production-m" : "\/m"/,
    /hasPermission\(user\.permissions, "page:chat-analytics"\)/,
    /returnsToUsCollab \? "\/m\/chat-analytics\?from=us-collab" : "\/m\/chat-analytics"/,
    /navigate\(path, \{ replace: replaceOverlayEntry \}\)/,
    /pushMobileOverlayState\(MENU_OVERLAY\)/,
    /closeMobileOverlay\(MENU_OVERLAY/,
    /useMobileOverlayBack\(menuOpen, MENU_OVERLAY/,
  ]) {
    assert.match(shell, contract);
  }
  assert.match(shell, /aria-current=\{!isChatAnalytics \? "page" : undefined\}/);
  assert.match(shell, /aria-current=\{isChatAnalytics \? "page" : undefined\}/);
});

test("长内容布局、登录守卫、反馈出口与备案 footer 保持完整", () => {
  assert.match(shell, /<Navigate[\s\S]{0,160}?to="\/login"[\s\S]{0,160}?state=\{\{ from: location\.pathname \+ location\.search \+ location\.hash \}\}/);
  assert.match(shell, /<div className="flex min-h-\[100dvh\] flex-col bg-slate-50">/);
  assert.match(shell, /<main className="flex-1">[\s\S]*?<Outlet \/>[\s\S]*?<\/main>/);
  assert.match(shell, /<SiteRecordFooter/);
  assert.match(shell, /<Toaster richColors position="top-center" \/>/);
  assert.match(shell, /role="status"/);
});
