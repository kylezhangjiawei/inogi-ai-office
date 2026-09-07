import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const pagePaths = {
  "海外询盘": "src/app/InquiryPage.tsx",
  "会议纪要": "src/app/MeetingMinutes.tsx",
  "邮件 AI": "src/app/EmailAIPage.tsx",
  "汇报压缩": "src/app/ReportCompressionPage.tsx",
  "简历筛选": "src/app/ResumeScreeningPage.tsx",
  "员工档案": "src/app/EmployeeArchivePage.tsx",
  "考勤管理": "src/app/AttendancePage.tsx",
  "费用管理": "src/modules/expense/pages/ExpenseModule.tsx",
};

const pages = Object.fromEntries(
  Object.entries(pagePaths).map(([name, path]) => [name, source(path)]),
);

function createInvoiceApi(authFetch) {
  const text = source('src/modules/expense/services/expenseService.ts');
  const ast = ts.createSourceFile('expenseService.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node)
    && ['request', 'appendDepartment', 'fetchAllInvoices', 'toInvoice', 'applyLocalInvoiceFilters', 'fallbackWithWarning'].includes(node.name?.text));
  const service = ast.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.getText(ast) === 'expenseService');
  const methods = service.initializer.properties.filter((node) => ['listInvoices', 'listInvoicesStrict'].includes(node.name?.getText(ast)));
  const code = ts.transpileModule(`${functions.map((node) => node.getText(ast)).join('\n')}\nreturn {${methods.map((node) => node.getText(ast)).join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('authFetch', 'readErrorMessage', code)(authFetch, async (_res, fallback) => fallback);
}

test('发票超过 200 张时按后端分页完整读取，筛选和部门参数贯穿每一页', async () => {
  const invoices = Array.from({ length: 405 }, (_, index) => ({ id: `invoice-${index}`, amount: index + 1, category_confidence: 1 }));
  for (const method of ['listInvoices', 'listInvoicesStrict']) {
    const calls = [];
    const api = createInvoiceApi(async (url) => {
      const params = new URL(url, 'http://local').searchParams;
      const page = Number(params.get('page'));
      calls.push(params);
      return Response.json({ items: invoices.slice((page - 1) * 200, page * 200), page, total: 405, total_pages: 3 });
    });
    const result = await api[method]({ keyword: ' 发票 ', status: '待处理', category: '其他' }, 'RD');
    assert.equal(result.length, 405);
    assert.equal(result.at(-1).id, 'invoice-404');
    assert.equal(result.reduce((sum, item) => sum + item.amount, 0), 82215, '下游统计和导出应拿到全部金额');
    assert.deepEqual(calls.map((params) => params.get('page')), ['1', '2', '3']);
    for (const params of calls) {
      assert.equal(params.get('page_size'), '200');
      assert.equal(params.get('department'), 'RD');
      assert.equal(params.get('keyword'), '发票');
      assert.equal(params.get('status'), '待处理');
      assert.equal(params.get('category'), '其他');
    }
  }
});

test('发票空列表和整页边界只读实际页数，后续页失败不能返回不完整列表', async () => {
  for (const total of [0, 200]) {
    let calls = 0;
    const api = createInvoiceApi(async () => {
      calls += 1;
      return Response.json({ items: Array.from({ length: total }, (_, index) => ({ id: String(index), amount: 1, category_confidence: 1 })), page: 1, total, total_pages: 1 });
    });
    assert.equal((await api.listInvoicesStrict()).length, total);
    assert.equal(calls, 1);
  }
  let attempts = 0;
  const api = createInvoiceApi(async () => {
    attempts += 1;
    if (attempts === 2) throw new Error('network-error');
    return Response.json({ items: [{ id: 'one', amount: 1, category_confidence: 1 }], page: 1, total: 2, total_pages: 2 });
  });
  await assert.rejects(() => api.listInvoicesStrict(), { message: 'network-error' });
  assert.equal(attempts, 2);
});

test('发票加载期间页码回退或总数变化会明确失败，避免按重复或遗漏记录统计', async () => {
  let attempts = 0;
  const api = createInvoiceApi(async () => {
    attempts += 1;
    return Response.json(attempts === 1
      ? { items: [{ id: 'one' }], page: 1, total: 2, total_pages: 2 }
      : { items: [{ id: 'one' }], page: 1, total: 1, total_pages: 1 });
  });
  await assert.rejects(() => api.listInvoicesStrict(), { message: '发票列表在加载期间发生变化，请重新加载后再统计或导出' });
});

function createAiMatch(scope) {
  const ast = ts.createSourceFile('ExpenseModule.tsx', pages['费用管理'], ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runAiMatch') initializer = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer);
  const code = ts.transpileModule(`return ${initializer}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

test('自动匹配接口失败不改变本地关联状态，也不提示临时关联成功', async () => {
  for (const [status, expected] of [[403, '没有自动匹配票据的权限，请联系管理员'], [401, '登录已失效，请重新登录后再试'], [500, 'AI 匹配服务暂不可用，请稍后重试'], [undefined, 'AI 匹配服务暂不可用，请稍后重试']]) {
    const invoice = { id: 'invoice-1', amount: 128, issuer: '同一商户', matched: false };
    const voucher = { id: 'voucher-1', amount: 128, vendor: '同一商户', matched: false };
    let saving = false;
    let updates = 0;
    let reloads = 0;
    const messages = [];
    const run = createAiMatch({
      useCallback: (fn) => fn,
      t: (text) => text,
      setAiMatching: (value) => { saving = value; },
      expenseService: { autoMatchVouchers: async () => { throw Object.assign(new Error('Request failed'), { status }); } },
      applyMatchLinks: () => { updates++; invoice.matched = true; voucher.matched = true; },
      reloadExpenseData: async () => { reloads++; },
      toast: { error: (text) => messages.push(['error', text]), success: (text) => messages.push(['success', text]), info: (text) => messages.push(['info', text]) },
    });
    await run();
    assert.equal(updates, 0);
    assert.equal(reloads, 0);
    assert.equal(invoice.matched, false);
    assert.equal(voucher.matched, false);
    assert.equal(saving, false);
    assert.deepEqual(messages, [['error', expected]]);
  }
});

test('自动匹配成功只应用服务端确认的关联并重新读取持久化数据', async () => {
  const links = [{ invoice_id: 'invoice-1', voucher_id: 'voucher-1' }];
  const applied = [];
  let reloads = 0;
  let success = 0;
  const run = createAiMatch({
    useCallback: (fn) => fn, t: (text) => text, setAiMatching() {},
    expenseService: { autoMatchVouchers: async () => ({ links, auto_linked: 1, manual_review: 0 }) },
    applyMatchLinks: (value) => applied.push(value),
    reloadExpenseData: async () => { reloads++; },
    toast: { success: () => { success++; }, error: assert.fail, info: assert.fail },
  });
  await run();
  assert.deepEqual(applied, [links]);
  assert.equal(reloads, 1);
  assert.equal(success, 1);
});

test("协同与人事八个实现页面统一挂载 Horizon 根、页头和指标带", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /className="horizon-theme hz-page/, `${name}应挂载 Horizon 页面根作用域`);
    assert.match(page, /<HorizonPageHeader(?:\s|>)/, `${name}应使用统一 Horizon 页头`);
    assert.match(page, /<HorizonMetricGrid(?:\s|>)/, `${name}应使用统一 KPI 指标带`);
  }
});

test("协同与人事页面不包含禁用视觉、位移、手写全屏弹层或 MUI", () => {
  const forbiddenPatterns = [
    ["渐变", /gradient/i],
    ["紫色旧品牌类", /\b(?:purple|violet|indigo)-/i],
    ["装饰性字距", /\btracking-/],
    ["悬停位移", /hover:-translate/],
    ["手写全屏弹层", /fixed\s+inset/],
    ["MUI", /@mui(?:\/material)?|\bMui[A-Z]/],
  ];

  for (const [name, page] of Object.entries(pages)) {
    for (const [patternName, pattern] of forbiddenPatterns) {
      assert.doesNotMatch(page, pattern, `${name}不应包含${patternName}`);
    }
  }
});

test("邮件 AI 与汇报压缩使用标准 Dialog 并提供就地表单错误", () => {
  const email = pages["邮件 AI"];
  const report = pages["汇报压缩"];

  assert.match(email, /<Dialog open=\{previewOpen\}/);
  assert.match(email, /<DialogContent className="horizon-portal/);
  assert.match(email, /<Label htmlFor="email-recipient"/);
  assert.match(email, /aria-invalid=\{Boolean\(draftError\)\}/);
  assert.match(email, /aria-describedby=\{draftError/);
  assert.match(email, /id="email-draft-error"[\s\S]{0,180}?role="alert"/);
  assert.match(email, /id="email-recipient-error"[\s\S]{0,180}?role="alert"/);

  assert.match(report, /<Dialog open=\{exportOpen\}/);
  assert.match(report, /<DialogContent className="horizon-portal/);
  assert.match(report, /<Label htmlFor="report-source"/);
  assert.match(report, /aria-invalid=\{Boolean\(inputError\)\}/);
  assert.match(report, /aria-describedby=\{inputError/);
  assert.match(report, /id="report-source-error"[\s\S]{0,180}?role="alert"/);
});

test("询盘与会议页面分别使用标准 Dialog 和破坏性 AlertDialog", () => {
  const inquiry = pages["海外询盘"];
  const meeting = pages["会议纪要"];

  assert.match(inquiry, /<Dialog open=\{crmOpen\} onOpenChange=\{setCrmOpen\}>/);
  assert.match(inquiry, /<DialogContent className="horizon-portal/);
  assert.match(inquiry, /<DialogTitle className="text-balance[^>]*>同步 CRM 台账/);
  assert.match(inquiry, /<Label htmlFor=\{id\}>/);
  assert.match(inquiry, /handleNextStep/);

  assert.match(meeting, /<AlertDialog open=\{deleteActionId !== null\}/);
  assert.match(meeting, /<AlertDialogContent className="horizon-portal"/);
  assert.match(meeting, /<AlertDialogTitle[^>]*>删除该行动项？/);
  assert.match(meeting, /handleDeleteAction\(deleteActionId\)/);
  assert.match(meeting, /aria-invalid=\{Boolean\(actionErrors\./);
  assert.match(meeting, /role="alert"/);
});

test("简历筛选使用语义表格并为候选人与规则删除提供统一确认", () => {
  const resume = pages["简历筛选"];

  assert.match(resume, /<caption className="sr-only">候选人筛选结果及评估操作<\/caption>/);
  assert.match(resume, /<th scope="col"/);
  assert.match(resume, /aria-label="全选当前页候选人"/);
  assert.match(resume, /<AlertDialog[\s\S]{0,220}?open=\{Boolean\(deleteConfirm\)\}/);
  assert.match(resume, /deleteConfirm\.kind === "job-rule"/);
  assert.match(resume, /deleteConfirm\.kind === "candidate"/);
  assert.match(resume, /recruitmentApi\.deleteCandidate\(/);
});

test("员工档案使用语义花名册并确认档案、材料删除与员工转正", () => {
  const employee = pages["员工档案"];

  assert.match(employee, /<caption className="sr-only">\{translate\("员工花名册与归档流程状态"\)\}<\/caption>/);
  assert.match(employee, /<th[\s\S]{0,120}?scope="col"/);
  assert.match(employee, /function EmployeeDeleteDialog\(/);
  assert.match(employee, /function EmployeeRegularizationDialog\(/);
  assert.match(employee, /<AlertDialogTitle[^>]*>\{translate\("删除材料记录？"\)\}/);
  assert.match(employee, /<AlertDialogTitle[^>]*>\{translate\("删除人员档案"\)\}/);
  assert.match(employee, /\{translate\("确认员工转正"\)\}/);
  assert.match(employee, /id="employee-regularization-error"[^>]*role="alert"/);
});

test("考勤页面的日矩阵和月度明细具备表格语义并确认清除记录", () => {
  const attendance = pages["考勤管理"];

  assert.match(attendance, /<caption className="sr-only">\{monthLabel\(month\)\}人员每日考勤与月度汇总矩阵<\/caption>/);
  assert.match(attendance, /<caption className="sr-only">\{monthLabel\(data\.month\)\}人员加班时长与调休结余<\/caption>/);
  assert.match(attendance, /<th scope="col"/);
  assert.match(attendance, /<AlertDialogTrigger asChild>/);
  assert.match(attendance, /<AlertDialogTitle>确认清除本日考勤记录？<\/AlertDialogTitle>/);
  assert.match(attendance, /onDeleted=\{\(record\) => void handleDelete\(record\)\}/);
});

test("费用模块保留加载、上传、匹配、报销、审批与归档 API 契约", () => {
  const expense = pages["费用管理"];
  const serviceCalls = [
    "getDashboardStrict",
    "listInvoicesStrict",
    "listVouchers",
    "listReimbursementsStrict",
    "uploadVoucherFiles",
    "uploadInvoiceFiles",
    "autoMatchVouchers",
    "linkVoucher",
    "createReimbursement",
    "submitWeComApproval",
    "syncWeComApproval",
    "deleteDraftReimbursement",
    "saveArchiveConfig",
    "reassignDepartment",
  ];

  for (const call of serviceCalls) {
    assert.match(expense, new RegExp(`expenseService\\.${call}\\(`), `费用模块缺少 ${call} 调用链`);
  }

  assert.match(expense, /integrationManagementApi\.listMailboxes\(/);
  assert.match(expense, /const handleExpenseUpload = useCallback/);
  assert.match(expense, /const handleInvoiceUpload = useCallback/);
  assert.match(expense, /const runAiMatch = useCallback/);
  assert.match(expense, /const handleManualLink = useCallback/);
  assert.match(expense, /const handleConfirmCreateApproval = useCallback/);
});
