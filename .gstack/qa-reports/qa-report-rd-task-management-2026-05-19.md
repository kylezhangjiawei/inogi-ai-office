# 研发任务管理模块流程自测报告

- 日期：2026-05-19
- 环境：本地 `http://localhost:5173` + API `http://localhost:3000`
- 账号：本地管理员账号，凭证不写入报告
- 范围：研发任务驾驶舱、个人工作台、研发主管驾驶舱、审批流配置、操作留痕、AI 立项
- 结论：满足发布条件
- 健康分：93 / 100

## 发布 Gate

建议发布。直接立项、提交审核、主管待审队列、审核通过、任务生效、驾驶舱统计、主管任务列表和审计留痕均已完成闭环自测。

本次发现的 P0 阻塞项已修复：提交审核后的 `pending_review` 任务现在会进入主管驾驶舱行动队列，可按“待审核”筛选，并可从列表或任务详情完成通过/驳回。通过后任务状态变为 `in_progress`，并写入 `proposal.approved` 审计记录。

## 已验证通过

1. 构建检查通过
   - `npm run build` 通过。
   - `npm --prefix apps/api run build` 通过。
   - 根项目没有 `test` 脚本，无法执行自动化单测。
   - 前端构建仍有 2.6 MB chunk 警告，非阻塞。

2. 登录与模块导航通过
   - `/login` 登录成功。
   - 研发任务管理菜单项可进入：任务驾驶舱、个人工作台、主管驾驶舱、审批流配置、操作留痕、AI 策略。

3. AI 直接立项通过
   - 输入测试描述后，AI 解析成功生成 5 个任务。
   - 点击“直接立项并分配”后，任务落库成功。
   - 新任务出现在驾驶舱和主管驾驶舱任务列表。
   - 审计留痕包含 AI 解析和任务创建记录。

4. 提交审核闭环通过
   - 测试立项 `QA自测审核流-风扇噪声复核` 提交审核后生成 2 个 `pending_review` 任务。
   - 主管驾驶舱行动队列显示 `2 待审核 · 3 待指派`。
   - 点击“待审核”后，两条任务均出现在任务列表，操作列显示“通过”。
   - 两条任务点击“通过”后，API 状态均变为 `in_progress`。
   - 本地审计留痕写入 `proposal.approved`，包含状态从 `pending_review` 到 `in_progress` 的变更。

5. 主管驾驶舱通过
   - KPI 行动队列包含待审核和待指派数量。
   - 待审核任务可筛选、可审核通过。
   - 任务详情抽屉提供“审核通过”和“驳回”动作。
   - 新建任务表单、转派弹窗、负责人禁用规则均正常。

## 修复内容

1. `src/app/RDDirectorDashboardPage.tsx`
   - 将 `pending_review` 纳入 KPI 筛选和行动队列统计。
   - 任务列表增加“待审核”快捷入口。
   - 待审核任务操作列增加“通过”动作。
   - 任务详情抽屉增加“审核通过 / 驳回”动作。
   - 审核动作调用任务更新接口，刷新驾驶舱，并记录 `proposal.approved` / `proposal.rejected` 审计日志。

2. `src/app/RDProjectProposalDialog.tsx`
   - 提交审核成功提示改为明确进入“主管驾驶舱待审核队列”。

## 非阻塞风险

1. 审批流配置页面存在认知风险
   - 页面标题为 `立项审批 · 默认流程`，但同页显示多类流程权限，包括直接立项、任务转派审批、任务封存审批等。
   - 当前不阻塞发布，但建议后续拆分流程配置或强化文案。

2. 个人工作台对当前管理员为空
   - 直接立项任务分配给研发成员后，管理员个人工作台不显示这些任务。
   - 这符合角色逻辑，但建议后续用真实研发成员账号补跑“我的任务 -> 进度提交 -> 留痕”路径。

3. 前端包体积风险
   - Vite 构建提示主 chunk 约 `2.6 MB`，gzip 约 `711 KB`。
   - 不阻塞当前发布，但建议后续做路由级拆包。

## 证据截图

截图位于 `.gstack/qa-reports/screenshots/`，新增修复后截图：

- `rd-director-pending-review-fixed-2026-05-19.png`

历史自测截图：

- `rd-task-management-initial.png`
- `rd-task-management-subsystem-detail.png`
- `rd-task-management-task-detail.png`
- `rd-my-workspace-initial.png`
- `rd-ai-project-dialog.png`
- `rd-ai-project-parse-result.png`
- `rd-ai-project-review-flow.png`
- `rd-ai-project-created.png`
- `rd-dashboard-after-ai-create.png`
- `rd-audit-log-after-create.png`
- `rd-approval-flow.png`
- `rd-director-dashboard.png`
- `rd-director-new-task-form.png`
- `rd-director-reassign-dialog.png`
- `rd-ai-project-submitted-review.png`
- `rd-director-after-submit-approval.png`

## 测试数据

本次自测在本地数据库创建并流转了测试立项和任务：

- `QA自测立项-电池PCB验证流程`，直接立项，生成 5 个任务。
- `QA自测审核流-风扇噪声复核`，提交审核，生成 2 个待审核任务，复测中已通过审核并进入 `in_progress`。

## 建议发布判定

- 完整发布：通过。
- 发布说明：可开放直接立项、提交审核、主管审核、任务转派、驾驶舱统计和审计留痕。
- 后续优化：拆分审批流配置表达、补研发成员账号进度提交路径、规划前端拆包。
