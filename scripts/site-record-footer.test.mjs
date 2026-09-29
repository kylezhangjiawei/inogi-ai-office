import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as router from 'react-router';
import ts from 'typescript';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
function loadSource(path, replacements = {}) {
  const input = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (name) => Object.hasOwn(replacements, name) ? replacements[name] : require(name), module, module.exports,
  );
  return module.exports;
}
const utils = loadSource('src/app/components/ui/utils.ts');
const footerModule = loadSource('src/app/components/SiteRecordFooter.tsx', { './ui/utils': utils });
const renderAt = (path, element) => renderToStaticMarkup(React.createElement(router.StaticRouter, { location: path }, element));
const uiServer = await createServer({ configFile: false, envFile: false, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
let inputModule;
try { inputModule = await uiServer.ssrLoadModule('/src/app/components/ui/input.tsx'); }
finally { await uiServer.close(); }

test('备案号只在登录路由显示，背景透明且不模糊登录页背景', () => {
  for (const path of ['/login', '/login/', '/login?from=%2Fproc-inventory-readiness']) {
    const html = renderAt(path, React.createElement(footerModule.SiteRecordFooter));
    assert.match(html, /<footer[^>]*style="[^"]*display:flex/);
    assert.match(html, /<footer[^>]*style="[^"]*background:transparent/);
    assert.doesNotMatch(html, /backdrop-blur|bg-white/);
    assert.match(html, /苏ICP备2021046412号-3/);
    assert.match(html, /苏公网安备32011202001840号/);
  }
});

test('桌面、移动、分享与其他路由均明确 display none，不占页脚空间', () => {
  for (const path of ['/', '/proc-inventory-readiness', '/m', '/m/task/123', '/production-m', '/us-collab-m', '/share/abc', '/login/details']) {
    const html = renderAt(path, React.createElement(footerModule.SiteRecordFooter, { tone: 'horizon' }));
    assert.match(html, /<footer[^>]*style="[^"]*display:none/, path);
  }
});

test('登录状态恢复及已登录跳转时不渲染备案，未登录表单保留透明备案', () => {
  let auth = { hydrated: true, user: null, login: async () => ({ ok: true }) };
  const { LoginPage } = loadSource('src/app/LoginPage.tsx', {
    './components/ui/button': loadSource('src/app/components/ui/button.tsx', { './utils': utils }),
    './components/ui/input': inputModule,
    './auth': { useAuth: () => auth },
    './lib/authSession': { authFetch: () => { throw new Error('SSR must not issue background requests'); } },
    './components/SiteRecordFooter': footerModule,
    '../assets/logo.png': 'logo.png',
    'react-router': { ...router, Navigate: () => null },
  });
  const renderLogin = () => renderAt('/login', React.createElement(LoginPage));
  const html = renderLogin();
  const footer = html.match(/<footer[^>]*>/)?.[0] ?? '';
  assert.match(footer, /display:flex/);
  assert.match(footer, /background:transparent/);
  assert.doesNotMatch(footer, /bg-white|border-white|backdrop-blur/);
  auth = { ...auth, hydrated: false };
  assert.doesNotMatch(renderLogin(), /<footer/);
  auth = { ...auth, hydrated: true, user: { id: 'signed-in-user' } };
  assert.doesNotMatch(renderLogin(), /<footer/);
});
