# 采购已有页面收尾验证

日期：2026-09-14。范围为 S01 采购工作台的来源聚合、S08/S14 订单行人工可用日期确认记录，以及来源往返。

使用真实页面组件，浏览器测试数据全部由仅监听 127.0.0.1 的隔离内存服务提供。禁用真实 API 代理，未知接口本地终止；没有读写正式业务数据。当前隔离入口：http://127.0.0.1:4181/__qa/proc-finishing。

## 已验证交互

- 普通采购与包含样品要求/记录的任务互斥分类；相关备货、待到货订单行分别计数。本人之外的同名买手任务不进入工作台。
- 输入无匹配搜索仍保留跨月未完与无日期计划；跨月入口清除冲突的状态、搜索条件。
- `completed + partial_received` 的跨月计划保留「下单达标，收货 / 检验待跟进」，不会被当作全部完成。本人创建与经办责任明确区分。
- 备货更新失败保留并标注上次结果，来源操作暂不可用；无备货权限显示未读取和破折号。
- 供应商甲筛选下仅含其两条待到货记录，不混入同任务供应商乙的行；超收记录显示数量待核对，正常记录显示未收40件。
- 订单历史12条按10/2分页；清空日期和首次确认分别显示前后值。供应商原承诺日显示来源未提供。
- 第2页刷新失败保留第2页两条记录；恢复后重试回到新快照第1页。
- 「返回原订单行」关闭抽屉后，焦点实际恢复到镜像ID `qa-date-line-2` 的 TR。
- 无审计权限时提示需要操作留痕权限；仅研发管理身份即使 API canViewAll=true，仍仅显示其可见6条，并说明可能不是全部历史。
- 390×844：历史抽屉和工作台 documentWidth=viewportWidth=390，底部按钮可用；表格在自身区域滚动。
- 聚合来源能精准打开备货计划，保留 `stockFocus` / `stockOpen`；备货页提供返回工作台入口。

浏览器截图经本任务工具观察，未另存图片。开发热更新期间一次分页状态被重置，已在组件稳定后重跑第2页失败恢复流程通过。不能将热更新中间态当作最终行为。

自动检查结果见同目录日志；不代表全仓库测试、正式权限配置或业务数据验收。


## 自动检查

183 / 183 通过：`node --test scripts/procurement-workspace-*.test.mjs scripts/purchase-order-*.test.mjs scripts/workspace-arrival-navigation.test.mjs scripts/stock-plan-navigation.test.mjs scripts/stock-plan-order-date-check.test.mjs`。

`npm run typecheck` 与 `npm run build` 通过。分别见 tests.txt、typecheck.txt、build.txt。最终来源标签往返实测：`source=stock` 保持选中，月份、供应商和 task 参数保留。

## 复现

从项目根目录执行 `node artifacts/qa/procurement-finishing/harness/server.mjs`，确保4181端口空闲。夹具仅覆盖本轮读路径和错误切换，业务写入本地拒绝；不持久保存身份或令牌。当前服务若已运行，无需重复启动。顶栏可进入订单、模拟读取失败，或切换权限；授权并非真实账号权限配置。
