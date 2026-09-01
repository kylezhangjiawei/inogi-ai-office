import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
