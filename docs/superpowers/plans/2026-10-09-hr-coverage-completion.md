# HR 页面业务覆盖补齐实施计划

> For agentic workers: use subagent-driven-development for the three isolated view groups; the coordinator owns shared state, forms and final verification.

**Goal:** 按本次用户授权补齐验收报告中的 24 页前端缺项，保持原有 25 个入口与设计风格。
**Architecture:** 沿用 React 内存会话与 HrRecord 模型，补稳定人员关联、跨模块更新、可验证业务规则。共用表单/列表/材料组件由协调代理维护，三组业务视图独立实施。
**Tech Stack:** React 18 / TypeScript / existing Horizon + Radix components / ExcelJS / Node test runner.
**Spec:** `tmp/hr-audit-20261009/acceptance-matrix.json`、原始需求表 J4:J28 及原型 HTML；用户已明确要求补全其后续逻辑和静态页面。

## Global Constraints

- 保持交互演示范围，刷新恢复样例；不伪装真实 AI、审批、权限、邮件、设备和持久化已接入。
- 不改无关的费用、AI 或后端既有未提交变更；在当前 dev4 工作区继续 HR 页面。2026-10-10 用户已授权生成本地 commit，范围仅含 HR 实现、导航、相关测试与本计划；未授权推送或发布。
- 复用既有字体、紫色主色、卡片、表单和侧栏；缺项采用具体业务结构而不是新的通用占位卡。
- HrProps 新增 employeeId、department、updateModule(moduleId,id,patch,event)；add(moduleId,row) 返回新记录 id。人员关联字段统一为“人员编号”（E-001/E-002）。
- 全局 RecordForm 可接收各视图扩充的 module.fields；新增字段需有必要校验。跨模块动作保留来源编号。

## Review Focus

- 批准后的关键字段更改必须撤销批准，不能继续打印/发布。
- 空值、负数、重复编码、非法周期、日期倒置和部门循环引用要阻止保存。
- 人员范围按稳定编号，不按记录标题；历史信息、阶段和跨模块数据不可被覆盖丢失。
- 新月份/空列表必须有可操作的建立入口；双角色流程必须完成全部必要阶段。
- 业务演示含正常、空态、异常及移动端表单，不能用“未接入”替代前端状态。

## Tasks

- [x] 1. Shared foundation (root): HrPreview/HrRecord state operations, stable person scopes, common form validation, approval invalidation, task recurrence, responsive additions. Tests first for approval invalidation, validation, recurrence, identity filtering and field preservation.
- [x] 2. Recruitment (agent): JD approved-source publication, complete registration/intake and candidate entry, dual interview evidence, external assessment link/report flow, complete archive copy, OFFER mail/attachments/reapproval display. Own RecruitmentViews + recruitment logic/schema/tests only.
- [x] 3. People (agent): archive talent/contract/training panels, knowledge citations/self-service, attendance reconciliation, account event states, approval filters/delegation, course/employee scopes, independent probation stages, new-month performance/config/import, actual scripted coaching state flow. Own PeopleViews and new people-focused files/tests only.
- [x] 4. Organization/admin (agent): complete dashboard metric structures and department aggregation, dynamic org/position/competency diagrams, purchase/asset lifecycle, two-document expense comparison, room time/state/use overview, per-action meeting task sync. Own BusinessWorkViews and its logic/tests only.
- [x] 5. Integration and verification (root): read all diffs against 25-row matrix; run focused tests/typecheck/build and actual desktop/mobile routes and primary/error interactions. Save an updated acceptance result with actual remaining external dependencies.

## Execution notes

- Existing accepted scope and specific audit findings provide the design basis; current request authorizes implementation, so no repeated design approval is needed.
- Missing ponytail skill has no locally verified source; apply the explicit reuse/minimal-correctness user rule without claiming the skill was loaded.
- Browser fallback to temporary local headless Edge remains authorized by the earlier user reply in this session.

## Initial completion verification (2026-10-09)

- 39 targeted HR logic/component regression tests passed; latest evidence: `tmp/hr-completion-20261009/tests.log`.
- `npm run typecheck` and `npm run build` passed; logs saved alongside the report.
- 25 desktop (1440 px) and 25 mobile (390 px) screenshots captured; no page errors or page-level horizontal overflow. All route screenshots reviewed; a mobile long-form save action was also verified.
- Root browser flows 6/6 passed: daily recurrence, JD approved snapshot/reapproval, OFFER validation/reapproval, dual interview, full intake/archive/assessment/download, mobile editing. New candidate stable identity and employee self-entry also passed.
- People flows 9/9 plus configuration and boundary checks passed; organization/admin primary and extended browser checks passed. Cross-review found six issues; all were fixed with regression evidence before delivery.
- Deliverable: `tmp/hr-completion-20261009/completion-report.html` and its 25-row `completion-matrix.json`. This is local frontend demonstration acceptance, not production or external service acceptance.
- Remaining dependencies: real AI/OCR, financial data, approval/authorization services, messages/email, external platform/device connections, approved company templates and persistent storage. No commit or deployment performed.

## Follow-up verification and commit scope (2026-10-10)

- All 25 HR preview routes share the main sidebar, breadcrumb and responsive application shell. Preview registration remains development-only under `/__preview/hr/:module?`.
- Subsequent passes covered record draft preservation, stable employee links, error recovery, long forms, desktop/mobile layout, long names and attachments, local validation feedback, and safety-card printing.
- The final visual pass passed 124 HR/navigation tests, type checking and production build. Commit preparation added a regression for custom navigation paths and aliases ending in `/`, normalized both sides of the match, then passed all 125 tests and a fresh type check.
- Fifth-pass browser checks covered all 25 business pages plus the workbench at three widths per business group (320–1280 px), with targeted before/after screenshots, 18 validation-feedback scenarios and an A4 safety-card print check.
- Local evidence: `tmp/hr-visual5-20261010/visual-report.html`, `visual-report.json`, `commit-tests.log`, `commit-typecheck.log`, and `build.log`. These temporary screenshots and logs remain ignored and are not committed.
- The requested commit includes the HR frontend, mock data, shared navigation integration and regression tests. Existing unrelated expense, AI and deployment changes are excluded. Real services and persistent storage remain pending; no push or deployment is included.
