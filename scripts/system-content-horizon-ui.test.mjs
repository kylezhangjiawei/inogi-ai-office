import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pages = {
  "腾讯 OCR 配置": source("src/app/OcrConfigManagementPage.tsx"),
  "邮箱配置": source("src/app/MailboxManagementPage.tsx"),
  "翻译管理": source("src/app/I18nManagementPage.tsx"),
  "运营素材管理": source("src/app/ContentSlotsPage.tsx"),
};

test("系统配置与内容运营四页统一挂载 Horizon 根、页头和四项指标", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面根作用域`);
    assert.match(page, /<HorizonPageHeader(?:\s|>)/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid(?:\s|>)/, `${name}应使用统一 KPI 指标带`);
    assert.equal(
      (page.match(/<HorizonMetric(?:\s|>)/g) ?? []).length,
      4,
      `${name}应保留四项动态 KPI`,
    );
  }
});

test("系统配置与内容运营四页不包含禁用视觉、手写全屏弹层或 MUI", () => {
  const forbiddenPatterns = [
    ["渐变", /gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
    ["固定视口高度", /\bh-screen\b/],
  ];

  for (const [name, page] of Object.entries(pages)) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${patternName}`);
    }
  }
});

test("腾讯 OCR 配置保留真实读写、启停与密钥校验契约", () => {
  const ocr = pages["腾讯 OCR 配置"];

  assert.match(ocr, /integrationManagementApi\.getOcrConfig\(\)/);
  assert.match(ocr, /integrationManagementApi\.saveOcrConfig\(\{/);
  assert.match(ocr, /secret_id: secretId\.trim\(\)/);
  assert.match(ocr, /secret_key: secretKey\.trim\(\) \? secretKey\.trim\(\) : undefined/);
  assert.match(ocr, /if \(enabled && !secretId\.trim\(\)\)/);
  assert.match(ocr, /if \(enabled && !secretKey\.trim\(\) && !config\?\.has_secret_key\)/);
  assert.match(ocr, /document\.getElementById\(nextErrors\.secretId \? "ocr-secret-id" : "ocr-secret-key"\)\?\.focus\(\)/);
  assert.match(ocr, /<Switch[\s\S]{0,220}?aria-label="启用腾讯 OCR"/);
});

test("腾讯 OCR 表单保留显式标签、就地错误和描述关联", () => {
  const ocr = pages["腾讯 OCR 配置"];

  for (const id of ["ocr-secret-id", "ocr-secret-key", "ocr-region", "ocr-endpoint", "ocr-invoice-action"]) {
    assert.match(ocr, new RegExp(`htmlFor="${id}"`), `OCR 配置缺少 ${id} 的显式标签`);
  }
  assert.match(ocr, /aria-invalid=\{Boolean\(fieldErrors\.secretId\)\}/);
  assert.match(ocr, /aria-describedby=\{fieldErrors\.secretId \? "ocr-secret-id-error" : undefined\}/);
  assert.match(ocr, /id="ocr-secret-id-error" role="alert"/);
  assert.match(ocr, /aria-invalid=\{Boolean\(fieldErrors\.secretKey\)\}/);
  assert.match(ocr, /aria-describedby=\{fieldErrors\.secretKey \? "ocr-secret-key-error" : undefined\}/);
  assert.match(ocr, /id="ocr-secret-key-error" role="alert"/);
});

test("邮箱配置保留服务端检索分页、增改删与启停 API", () => {
  const mailbox = pages["邮箱配置"];

  assert.match(mailbox, /const PAGE_SIZE = 8/);
  assert.match(mailbox, /integrationManagementApi\.listMailboxes\(\{/);
  assert.match(mailbox, /pageSize: PAGE_SIZE/);
  assert.match(mailbox, /keyword,/);
  assert.match(mailbox, /integrationManagementApi\.saveMailbox\(\{/);
  assert.match(mailbox, /integrationManagementApi\.deleteMailbox\(selectedRow\.id\)/);
  assert.match(mailbox, /onCheckedChange=\{\(checked\) => void handleToggleEnabled\(row, checked\)\}/);
  assert.match(mailbox, /onKeyDown=\{\(event\) => event\.key === "Enter" && handleJump\(\)\}/);
});

test("邮箱列表与编辑删除流程保留语义表格、可访问表单和标准 portal", () => {
  const mailbox = pages["邮箱配置"];

  assert.match(mailbox, /<TableCaption className="sr-only">邮箱配置列表/);
  assert.match(mailbox, /<TableHead[\s\S]{0,120}?scope="col"/);
  assert.match(mailbox, /<Label htmlFor="mailbox-search" className="sr-only">/);
  assert.match(mailbox, /aria-label=\{`\$\{row\.enabled \? "停用" : "启用"\}邮箱 \$\{row\.email\}`\}/);
  assert.match(mailbox, /aria-label=\{`编辑邮箱 \$\{row\.email\}`\}/);
  assert.match(mailbox, /aria-label=\{`删除邮箱 \$\{row\.email\}`\}/);
  assert.match(mailbox, /aria-invalid=\{Boolean\(formErrors\.email\)\}/);
  assert.match(mailbox, /aria-describedby=\{formErrors\.email \? "mailbox-email-error" : "mailbox-email-help"\}/);
  assert.match(mailbox, /<DialogContent[\s\S]{0,160}?className="horizon-portal/);
  assert.match(mailbox, /<AlertDialogContent[\s\S]{0,160}?className="horizon-portal/);
  assert.match(mailbox, /<AlertDialogTitle[^>]*>确认删除邮箱配置？<\/AlertDialogTitle>/);
});

test("翻译管理保留搜索筛选、Enter Escape 行内编辑和三类字典 API", () => {
  const i18n = pages["翻译管理"];

  assert.match(i18n, /"\/api\/i18n\/overview\/en"/);
  assert.match(i18n, /`\/api\/i18n\/dict\/en`/);
  assert.match(i18n, /`\/api\/i18n\/translate\/en`/);
  assert.match(i18n, /body: JSON\.stringify\(\{ keys: \[zh\] \}\)/);
  assert.match(i18n, /body: JSON\.stringify\(\{\}\)/);
  assert.match(i18n, /await reloadI18nDict\(\)/);
  assert.match(i18n, /moduleFilter !== "all"/);
  assert.match(i18n, /statusFilter !== "all"/);
  assert.match(i18n, /if \(event\.key === "Enter"\) void saveEntry\(row\.zh, editingValue\)/);
  assert.match(i18n, /if \(event\.key === "Escape"\) closeEditor\(row\.zh\)/);
  assert.match(i18n, /window\.requestAnimationFrame\(\(\) =>/);
  assert.match(i18n, /trigger\?\.focus\(\)/);
});

test("翻译管理保留 JSON merge 导入导出与可访问语义", () => {
  const i18n = pages["翻译管理"];

  assert.match(i18n, /Object\.fromEntries\(rows\.filter\(\(r\) => r\.en\)/);
  assert.match(i18n, /JSON\.parse\(await file\.text\(\)\)/);
  assert.match(i18n, /ref=\{importInputRef\}[\s\S]{0,160}?type="file"/);
  assert.match(i18n, /body: JSON\.stringify\(parsed\)/);
  assert.match(i18n, /已导入 \$\{Object\.keys\(parsed\)\.length\} 条（merge）/);
  assert.match(i18n, /<label htmlFor="i18n-keyword"/);
  assert.match(i18n, /aria-labelledby="i18n-module-filter-label"/);
  assert.match(i18n, /aria-labelledby="i18n-status-filter-label"/);
  assert.match(i18n, /<caption className="sr-only">中英文界面字典词条/);
  assert.match(i18n, /<th scope="col"/);
  assert.match(i18n, /aria-label=\{`编辑“\$\{row\.zh\}”的英文翻译`\}/);
  assert.match(i18n, /aria-label=\{`保存“\$\{row\.zh\}”的英文翻译`\}/);
  assert.match(i18n, /<HorizonEmptyState/);
  assert.match(i18n, /hasActiveFilters \? "清除筛选" : "重新加载"/);
});

test("运营素材管理保留配置、重生成、上传、历史和预算 API", () => {
  const content = pages["运营素材管理"];

  for (const apiName of ["list", "history", "updateConfig", "regenerate", "getGenBudget", "saveGenBudget"]) {
    assert.match(content, new RegExp(`contentSlotsApi\\.${apiName}\\(`), `运营素材管理缺少 ${apiName} 调用链`);
  }
  assert.match(content, /uploadSlotImage\(file\)/);
  assert.match(content, /if \(!file\.type\.startsWith\("image\/"\)\)/);
  assert.match(content, /if \(pool\.length >= 12\)/);
  assert.match(content, /staticImagePool: nextKeys/);
  assert.match(content, /staticList/);
});

test("运营素材模式、文件上传、历史和预算控件保留可访问状态", () => {
  const content = pages["运营素材管理"];

  assert.match(content, /role="group" aria-label=\{slot\.name \+ "更新方式"\}/);
  assert.match(content, /aria-pressed=\{mode === candidate\}/);
  assert.match(content, /<label htmlFor=\{promptId\}/);
  assert.match(content, /<label htmlFor=\{staticTextId\}/);
  assert.match(content, /type="file"[\s\S]{0,220}?aria-label=\{"选择要上传到 " \+ slot\.name \+ " 的图片"\}/);
  assert.match(content, /aria-expanded=\{historyOpen\}/);
  assert.match(content, /aria-controls=\{historyPanelId\}/);
  assert.match(content, /role="progressbar"/);
  assert.match(content, /aria-label="本月生成预算使用进度"/);
  assert.match(content, /aria-invalid=\{Boolean\(saveError\)\}/);
  assert.match(content, /role="alert"/);
  assert.match(content, /<HorizonEmptyState/);
});
