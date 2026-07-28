# 讨论邀请与回复链路设计 QA

## 比较目标

- source visual truth path:
  `/var/folders/jw/nkhflk0d6rz7fchydd7dkfnm0000gn/T/codex-clipboard-4fc4a7c3-6c55-4a1e-9713-74d4f19e1e7f.png`
- implementation screenshot paths:
  - `/Users/alex/.codex/visualizations/2026/07/24/019f920e-76d7-7623-abf1-886fda039bc1/rd-invite-final/01-notification-card.jpg`
  - `/Users/alex/.codex/visualizations/2026/07/24/019f920e-76d7-7623-abf1-886fda039bc1/rd-invite-final/02-pc-thread.jpg`
  - `/Users/alex/.codex/visualizations/2026/07/24/019f920e-76d7-7623-abf1-886fda039bc1/rd-invite-final/03-mobile-thread.jpg`
- combined comparison:
  `/Users/alex/.codex/visualizations/2026/07/24/019f920e-76d7-7623-abf1-886fda039bc1/rd-invite-final/04-comparison.jpg`
- state:
  被 @ 成员收到通知；通知显示“受邀参与”；点击“查看并回复”直达原进度线程；原始留痕、消息定位、引用回复、头像和附件入口可见。
- viewport and density:
  - source: 1446 × 844 px；桌面通知抽屉截图；density 未标注，按 1× 视觉比较。
  - PC implementation: 1280 × 720 CSS px，截图 1280 × 720 px，device scale factor 1。
  - mobile implementation: 390 × 844 CSS px，截图 390 × 844 px，device scale factor 1。
  - combined comparison: 1600 × 900 px；两侧等宽缩放，仅用于比较信息层级、密度和主操作，不用于像素级测量。

## Findings

- 当前没有遗留的 P0、P1 或 P2 问题。
- 字体与排版：沿用产品现有中文无衬线字体栈；标题、任务名、说明和时间形成清晰的四级层级；390 px 下未出现截断主操作或异常换行。
- 间距与布局节奏：通知卡片压缩为单卡片完成“身份—内容—解释—操作”；讨论页将原始留痕固定在上方、输入框固定在底部，一屏保留足够对话空间。
- 颜色与视觉令牌：继续使用现有 indigo 主色、slate 中性色和 rose 风险色；“提及你”“受邀参与”“仅限本线程”语义有颜色区分，未引入新的风格体系。
- 图片与资产：使用系统真实用户头像和既有 Lucide 图标；没有用占位符、手工 SVG、emoji 或 CSS 图形代替可见资产。
- 文案与内容：“查看并回复”替代原先只有“标记已处理”的死路；明确说明“只会加入当前线程”，降低用户对任务整体权限的误解。

## Full-view comparison evidence

- 原始截图中通知内容与处理按钮分离，用户只能把通知标记完成，缺少参与讨论的入口。
- 实现截图中“提及你 / 受邀参与 / 查看并回复”处于同一卡片首屏，主操作优先级高于“标记已处理”。
- 点击主操作后，页面保留原始进度记录，并把焦点消息以紧凑描边高亮定位；PC 与 390 px 移动端均未出现横向溢出或底部输入框遮挡。

## Focused region comparison evidence

- 不需要额外裁切：1280 × 720 的通知卡片和 390 × 844 的讨论页关键文字、标签、按钮、头像及附件入口均清晰可读；全视图已经覆盖本次关键区域。

## Comparison history

### Iteration 1

- earlier finding: `[P2]` 被定位消息的高亮背景作用于整行 flex 容器，形成大面积浅蓝空白，降低高密度信息表现。
- fix made: 将高亮移到实际消息气泡，只保留 2 px ring 和轻微背景变化。
- post-fix evidence:
  `/Users/alex/.codex/visualizations/2026/07/24/019f920e-76d7-7623-abf1-886fda039bc1/rd-invite-final/02-pc-thread.jpg`

### Iteration 2

- earlier finding: `[P2]` 新讨论深链未被全局页头识别，页头错误显示“系统首页”。
- fix made: 为研发与中美协同讨论深链增加动态标题解析，并补齐讨论提及通知的人类可读摘要。
- post-fix evidence: PC 最终截图页头显示“任务讨论”，内容区显示“关于这条进度的讨论”。

## Primary interactions tested

- 消息中心显示结构化讨论提及卡片。
- “查看并回复”点击后进入精确任务、进度锚点和消息定位。
- 通知打开后标记已读；实际回复后才标记已处理。
- 临时无页面权限账号通过真实 API 验证为 `thread_invitee`，返回 `can_post: true`。
- 同一账号尝试空消息返回业务校验 400，而不是权限 403，证明已通过线程级写权限。
- PC 与 390 px 移动端均渲染原始留痕、头像、引用回复和附件入口。
- 浏览器控制台 error 数量：0。
- 类型检查、API 构建、前端生产构建：通过。

## Open Questions

- 无阻塞问题。

## Implementation Checklist

- [x] @ 提及写入精确线程参与者。
- [x] 非任务成员仅能访问被邀请线程。
- [x] 受邀者可回复并上传图片、视频或文件。
- [x] 通知卡片提供“查看并回复”和独立“标记已处理”。
- [x] PC / 移动端深链、原始留痕和消息定位一致。
- [x] 临时 QA 通知和临时线程参与权已全部清理。

## Follow-up Polish

- 无必须的 P3 调整。

final result: passed
