# 生产前端视图进度

更新日期：2026-09-14。范围为页面和演示交互，正式数据接通、服务端权限及跨模块业务验收另行统计。

| 视图 | 当前开发预览入口 | 本轮状态 |
| --- | --- | --- |
| P00 生产管理总览 | `/__preview/production-overview` | 新增，原完工依据、分线任务与在岗确认、质量和交付风险 |
| P01 计划派工 | `/__preview/production-planning` | 原有；修复历史原任务深链接定位 |
| P02 现场报工 | `/__preview/field-tasks` | 原有，回归通过 |
| P03 检验与复验 | `/__preview/production-inspections` | 仓库已有，回归通过 |
| P04 生产问题转研发 | `/__preview/production-rd` | 新增，同一异常的技术处理与现场验证 |
| P05 转产确认 | `/__preview/production-transfer` | 新增，资料/试装/复验/岗位确认门槛 |
| P06 全部任务 | `/__preview/production-tasks` | 新增，原单聚合和独立跨月提醒 |
| P07 批次日安排 | `/__preview/production-planning?view=schedule` | 原有，回归通过 |
| P08 生产不良处理 | `/__preview/production-defects` | 原有实现收尾，与 P04 共享演示原异常，完成验收 |
| P09 批次档案 | `/__preview/batch-archives` | 原有，回归通过 |
| P10 ECN | `/__preview/ecn` | 原有，回归通过 |

生产 11 个视图已有开发预览覆盖，不等同项目上线完成度。只有 P04/P08 在本轮共用原异常的浏览器内存会话；其他预览仍有独立样例。正式菜单及生产发布未开放本轮预览。

本轮统一回归 488 / 488 项通过，类型检查与生产构建通过。最终总览和任务定位相关复查 37 / 37 项通过。验收日志：`artifacts/qa/production-remaining-views/`。业务范围分别见 `production-p04-frontend-scope.md`、`production-p05-frontend-scope.md`、`production-p00-p06-frontend-scope.md` 和 `production-p08-frontend-scope.md`。

后续续作已补充 S15 月度齐套与历史预测、S18 关键物料全量看板和 G00 公司管理总览，统一入口 `/__preview`，详见 `management-supply-frontend-progress.md`。同时修正 P00/P06 对已复验全部合格、待质量关闭事项的当前经办投影，原不良责任人不变，活动研发流程不被覆盖。

采购人员任务、订单详情等已有页面的聚合/变更历史仍需专项收尾。正式业务阶段还需数据、权限、附件、跨模块联动及业务验收。
