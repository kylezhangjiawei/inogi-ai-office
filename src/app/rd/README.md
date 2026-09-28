# 研发前端模块

页面负责路由上下文和页面级业务请求编排；这里存放共用实现及驾驶舱内相对独立的功能区。原有权限判断仍保留在对应操作处。

| 文件 | 职责 |
| --- | --- |
| `taskModel.ts` | 共享类型、状态与优先级显示、任务树索引和成员名称显示 |
| `TaskIdentity.tsx` | 负责人头像和子任务来源徽标 |
| `TaskActionDialogs.tsx` | 提交、完成、移交、添加协作人和审批确认 |
| `MoveTaskDialog.tsx` | 移动任务弹窗、按需加载目标产品分类 |
| `TaskCompletionScoreCard.tsx` | 完成评分及管理员调试详情 |
| `WorkItemsSection.tsx` | 工作项列表及对应操作 |
| `taskReport.ts` | 协同任务报告导出、附件 Blob 转换 |
| `taskMotion.ts` | 既有任务界面的共享动效参数 |
| `cockpitModel.ts` | 驾驶舱筛选、活动排序键、分类显示规则和单一备注回执 Context |
| `PersonTaskCockpit.tsx` | 成员主责/协作任务流、中文搜索、滚动分页、任务卡及附件按需加载 |
| `TaskAttachmentGallery.tsx` | 卡片附件缩略图、附件集合弹窗和可续签的大图预览 |
| `CategoryTree.tsx` | 分类导航树、分类编辑弹窗和风险提示 |
| `ProjectClassificationDialog.tsx` | 已有项目归类与人工确认流程；上线开关仍由页面控制，保持关闭 |

## 依赖方向

页面 → 本目录的组件/工具 → 已有 `lib`、`hooks` 和 UI 基础组件。

- 不从页面文件导入共用实现，也不在页面重新导出这些实现。
- 状态、权限、请求载荷和 UI 的调整不夹带在文件迁移中。
- 驾驶舱指标继续使用 `lib/rdCockpitMetrics.ts`，不复制计算逻辑。
- 人员任务流与页面通过 props 传递操作和导航，通过同一个 `NoteReceiptContext` 读取备注回执；不在组件内部另建一份 Context。
- 驾驶舱其余详情区、人员任务区内部的任务卡与加载逻辑、个人工作台抽屉仍可继续按职责拆分；不能为减少行数删除业务。

## 回归检查

- `scripts/rd-module-boundaries.test.mjs`：禁止反向依赖页面及研发模块循环引用，检查 Context 共享关系。
- `scripts/rd-shared-task-model.test.mjs`：直接加载真实模块验证任务树、成员显示、活动时间和组合筛选。
- 原有导航、中文输入法、附件续签及页面契约测试继续覆盖搬迁后的实现；调整源码取样位置，不降低断言。
