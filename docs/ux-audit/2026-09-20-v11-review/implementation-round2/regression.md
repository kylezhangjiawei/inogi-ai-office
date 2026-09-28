# 第二轮跨模块回归

2026-09-20，包含 F02 独立供应链风险、F11 订单影响批次、F15 单次发货 SN 和管理首页权限落盘，以及最后手机布局与生产总览路由改动的补测。此回归任务未运行浏览器、构建、真实数据库集成或部署。

## 最终结果

- 最近一次前端全量 `scripts/*.test.mjs` 共 221 个文件：2,435 / 2,435 通过，失败、取消及跳过均为 0。这轮执行早于最后的手机布局与路由调整。
- 最后改动的前端专项补测共 7 个文件：54 / 54 通过，其中 `mobile-routing.test.mjs` 为 10 项，包含新增的生产总览窄屏路由行为。此结果单独记录，不计作新一轮全量，也不与 2,435 项相加。
- 后端本轮相关 28 个 TypeScript 内存测试文件及 1 个 MTS 路由契约文件：累计 405 / 405 通过（403 TS + 2 MTS），失败及跳过均为 0。原执行为 390 项；随后单独补跑遗漏的 F11 / F15 两个文件，15 / 15 通过。
- 前端 `node node_modules/typescript/bin/tsc --noEmit` 在最后手机布局与路由调整后再次通过。
- API 目录 `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 通过。

完整执行输出见同目录 `frontend-all.log`、`backend-all.log`，最后前端专项及类型检查见 `mobile-final-ui.log`。日志被仓库现有 `*.log` 规则忽略，本次已保存于工作区，未提交。

## 命令与范围

前端最近全量统一执行 `node --test --test-reporter=tap --test-concurrency=4 scripts/*.test.mjs`，全部 221 个脚本在同一轮通过，没有排除部署测试。仅本次测试进程的 `TMP/TEMP` 设为工作区 `.tmp/regression-fake-deploy`，没有更改系统环境。部署脚本的 31 个用例使用模拟 pnpm/npm/pm2/curl/nginx/node，不操作真实基础设施。测试结束后临时目录已清理。

最后前端补测命令为 `node --test --test-reporter=tap scripts/active-shared-horizon-ui.test.mjs scripts/rd-shared-surfaces-horizon-ui.test.mjs scripts/mobile-shell-horizon-ui.test.mjs scripts/mobile-routing.test.mjs scripts/quality-production-horizon-ui.test.mjs scripts/management-dashboard.test.mjs scripts/planning-round2-ui.test.mjs`。本次仅验证共享 Horizon、手机外壳和路由、质量/生产、管理首页及规划相关契约，没有再次执行可能触发开发服务刷新的全量脚本。`src` 目录中的 LifecycleViews 专项不属于 `scripts/*.test.mjs` 全量范围，其已有专项证据仍单独记录。

后端在 `apps/api` 目录设置 `TS_NODE_TRANSPILE_ONLY=1`，用 `node --test --test-reporter=tap --test-concurrency=2 -r ts-node/register -r tsconfig-paths/register <文件列表>` 执行。完整精确文件列表记录于日志，涵盖生产执行、检验、生命周期、批次齐套、仓储和库存账、质量闭环、样品、备货、规划试算、供应商资质、个人原单待办、采购决策以及直接变更的采购/交期/ERP库存邻接契约。所有文件均先检查为内存 fixture 或源码/纯模型契约，排除所有 postgres 测试。MTS 路由契约单独执行 `node --test --test-reporter=tap test/production-dashboard-config.spec.mts`。

原后端日志标题提及 F11 / F15，但其 26 个 TS 文件列表遗漏了两个专用测试文件。现已保留原执行输出，并追加同一加载方式的补测命令：`node --test --test-reporter=tap --test-concurrency=2 -r ts-node/register -r tsconfig-paths/register test/purchase-delivery-impact.spec.ts test/production-shipment-serials.spec.ts`，分别覆盖 F11 的 8 项与 F15 的 7 项，全部通过；两文件均使用内存 fixture，不连接真实数据库。

## 首轮失败与处理

- 新页面的 5 处原生基础控件触发共享 UI 规范：样品上传、供应商上传/产品选择、质量记录名称、生命周期导航已改用系统 Input / Checkbox / Button；交互不变，行为与共享扫描均通过。
- 审计页的 2 个旧布局断言仍禁止表格高度限制、要求横向专用滚动。更新为当前设计的具体契约：桌面表格随视口限制高度并可横纵滚动、表头固定、区域键盘可聚焦、分页不在滚动表格内、手机记录内容完整可达；没有删除原有语义/详情/筛选/分页验证。
- 生产总览保留旧协同入口，但可见名称已简化；更新文案断言，仍验证原路由与跨工作区重挂载。
- 部署模拟首轮 14 个失败来自 Windows 沙箱临时目录 `/c/Users/Administrator/...` 权限，并非部署业务断言失效。改用工作区临时目录后原断言全部通过，没有跳过或弱化测试。
- 并行落盘时关键物料增加账号隔离依赖，旧 fixture 造成 3 个依赖失败；该模块代理同步更新真实依赖并新增原质量记录和供应商权限测试后，全量复跑通过。

首轮完整失败输出保留于 `frontend-initial.log`、`backend-initial.log`，并发中间态保留于 `frontend-concurrent.log`；上一轮功能补齐前的通过日志保留于 `frontend-before-final-scope.log`、`backend-before-final-scope.log`。最终日志保留各轮通过的完整执行段，并明确标注追加补测，不将分次运行写作同一轮全量。
