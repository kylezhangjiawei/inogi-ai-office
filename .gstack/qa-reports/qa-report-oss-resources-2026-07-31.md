# OSS 资源优化上线前 QA 报告

- 日期：2026-07-31
- 测试地址：`http://localhost:5173`
- 框架：React SPA + NestJS API
- 登录角色：超级管理员
- 基线提交：`6a56cd0`
- QA 修复提交：`e6e954f`
- 测试范围：资源展示、缩略图、附件完整列表、图片预览、任务懒加载、缓存 URL 稳定性、受影响页面冒烟、生产构建和专项自动化测试

## 结论

状态：**DONE_WITH_CONCERNS**

本地发布门禁通过。发现 1 个中等级控制台问题，已修复并通过浏览器复验。测试范围健康分从 **96/100** 提升到 **100/100**。

仍需在部署后执行一次真实生产网络测试；CDN 因备案暂不启用，不影响当前代码功能。

## 覆盖结果

| 检查项 | 结果 |
|---|---|
| 研发驾驶舱默认首批 6 个任务 | 通过 |
| 向下滚动后从 6 个增加到 12 个 | 通过 |
| 任务卡片附件缩略图正常显示 | 通过 |
| “查看全部”返回并显示完整附件数量 | 通过 |
| 图片附件全屏预览 | 通过 |
| 任务详情附件库 | 通过 |
| 研发知识库与上传入口 | 通过 |
| 缩略图使用 240/320px WebP OSS 处理参数 | 通过 |
| 页面刷新前后签名缩略图 URL 完全一致 | 通过 |
| 运营素材、员工档案、问题、采购、图像、视频页面 | 通过，无控制台错误 |
| OSS/附件/直传专项测试 | 14/14 通过 |
| 报销业务回归 | 5/5 通过 |
| TypeScript 检查 | 通过 |
| 前端生产构建 | 通过 |
| 后端生产构建 | 通过 |

## ISSUE-001：附件图片属性触发 React 控制台错误

- 严重程度：Medium
- 分类：Console / Compatibility
- 复现页面：`/rd-task-management`
- 现象：React 18 把 `fetchPriority` 识别为未知 DOM 属性并输出控制台错误。
- 用户影响：页面仍可使用，但会污染生产前错误监控，并掩盖真正的前端异常。
- 修复：移除 3 个附件图片组件中的不兼容属性，保留 `loading` 和 `decoding` 加载策略。
- 修复状态：Verified
- Commit：`e6e954f`
- 修改文件：
  - `src/app/RDTaskManagementPage.tsx`
  - `src/app/MobileRDCockpit.tsx`
  - `src/app/RDProgressEvidence.tsx`
- 复验：驾驶舱重新加载，首批 6 个任务与附件缩略图正常，控制台错误为 0。

测试证据：

- `screenshots/oss-rd-cockpit-before-fix-2026-07-31.png`
- `screenshots/oss-rd-cockpit-after-fix-2026-07-31.png`
- `screenshots/oss-rd-task-detail-2026-07-31.png`
- `screenshots/oss-rd-knowledge-base-2026-07-31.png`

## 当前关注项

1. 未在浏览器中执行真实文件上传，避免向当前连接的 `inogi-prod-files` 写入测试数据。直传、登记、失败清理和越权拦截由 14 项专项测试覆盖。
2. 生产部署后需要使用真实账号和网络复测驾驶舱首屏、重复访问缓存和大文件上传耗时。
3. `RDSheetUniver` 仍是约 1.686 MB gzip 的独立懒加载包，但不会进入系统或研发驾驶舱首屏。
4. CDN 和 OSS 控制台生命周期规则属于云端配置，不在本次本地代码发布门禁内。

## 发布建议

可以进入部署前环境配置和发布流程。生产环境至少补充独立的 `OSS_PREVIEW_SECRET`，CDN 变量保持未配置即可。

PR 摘要：QA found 1 issue, fixed 1, scoped health score 96 → 100.
