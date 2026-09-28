# 02 · 当前导航地图

审计日期：2026-09-17。以下是源码内置默认导航，不是根据目录重组后的建议。管理员可隐藏菜单、更改部分路径；每位用户还受角色与对象范围约束，实际环境需另行核验。

表中普通条件是单一权限；`Any` 表示任一满足，`All` 表示全部满足。两者组合时先满足 All，再判断 Any。可见性还受导航隐藏配置影响；不是只看权限代码是否存在。

## 一级与二级导航全表

一级是侧栏分组，二级是可点击菜单项；默认共 **15 个分组、75 个菜单项**。分组默认展开，可折叠，不是独立业务页面。

| 一级分组 | 二级菜单原名 | 默认路径 | 可见性条件（源码原表达式） | 证据 |
| --- | --- | --- | --- | --- |
| 总览 | 系统首页 | `/` | : page:dashboard | [定义](../../src/app/routesConfig.tsx#L111) |
| 供应链管理 | 供应链任务驾驶舱 | `/proc-cockpit` | : page:proc-cockpit | [定义](../../src/app/routesConfig.tsx#L116) |
| 供应链管理 | 个人工作台 | `/proc-my-workspace` | : page:proc-my-workspace | [定义](../../src/app/routesConfig.tsx#L117) |
| 供应链管理 | 我的仓管与质量任务 | `/proc-operational-tasks` | Any: ["proc-purchase-order:receive", "proc-purchase-order:inspect", "page:proc-cockpit"]；All: ["page:purchase-order-detail"] | [定义](../../src/app/routesConfig.tsx#L118) |
| 供应链管理 | 物料库 | `/proc-materials` | : page:proc-materials | [定义](../../src/app/routesConfig.tsx#L120) |
| 供应链管理 | 全部关键物料 | `/proc-key-materials` | : page:proc-key-materials | [定义](../../src/app/routesConfig.tsx#L121) |
| 供应链管理 | 库存齐套中心 | `/proc-inventory-readiness` | : page:proc-inventory-readiness | [定义](../../src/app/routesConfig.tsx#L122) |
| 供应链管理 | 供应商报价库 | `/proc-quote-book` | : page:proc-quote-book | [定义](../../src/app/routesConfig.tsx#L123) |
| 研发任务管理 | 研发任务驾驶舱 | `/rd-task-management` | : page:rd-task-management | [定义](../../src/app/routesConfig.tsx#L129) |
| 研发任务管理 | 个人工作台 | `/rd-my-workspace` | : page:rd-my-workspace | [定义](../../src/app/routesConfig.tsx#L130) |
| 研发任务管理 | 研发数据表 | `/rd-sheet` | : page:rd-sheet | [定义](../../src/app/routesConfig.tsx#L131) |
| 研发任务管理 | 问题记录与 AI 定位 | `/issue-ai` | : page:issue-ai | [定义](../../src/app/routesConfig.tsx#L132) |
| 研发任务管理 | 审批流配置 | `/rd-approval-flow` | : page:rd-approval-flow | [定义](../../src/app/routesConfig.tsx#L134) |
| 研发任务管理 | 研发 AI 策略 | `/rd-ai-settings` | : page:rd-ai-settings | [定义](../../src/app/routesConfig.tsx#L135) |
| 中美协同 | 协同任务驾驶舱 | `/us-collab-cockpit` | : page:us-collab-cockpit | [定义](../../src/app/routesConfig.tsx#L142) |
| 中美协同 | 协同工作台 | `/us-collab-workspace` | : page:us-collab-workspace | [定义](../../src/app/routesConfig.tsx#L143) |
| 中美协同 | 协同知识库 | `/us-collab-kb` | : page:dept-kb-us-collab | [定义](../../src/app/routesConfig.tsx#L144) |
| 中美协同 | 协同审批流配置 | `/us-collab-approval-flow` | : page:us-collab-approval-flow | [定义](../../src/app/routesConfig.tsx#L145) |
| 中美协同 | 协同 AI 策略 | `/us-collab-ai-settings` | : page:us-collab-ai-settings | [定义](../../src/app/routesConfig.tsx#L146) |
| 知识库 | 知识库 | `/dept-kb` | Any: [ ...DEPT_KBS.map((d) => `page:dept-kb-${d.id}`), "page:rd-knowledge-base", ] | [定义](../../src/app/routesConfig.tsx#L155) |
| 信息流转 | 售后 Case 管理 | `/after-sales` | : page:after-sales | [定义](../../src/app/routesConfig.tsx#L171) |
| 信息流转 | 研发问题分流 | `/rd-triage` | : page:rd-triage | [定义](../../src/app/routesConfig.tsx#L172) |
| 信息流转 | 注册项目里程碑 | `/registration-projects` | : page:registration-projects | [定义](../../src/app/routesConfig.tsx#L173) |
| 信息流转 | BOM 确认存档 | `/bom-archive` | : page:bom-archive | [定义](../../src/app/routesConfig.tsx#L174) |
| 信息流转 | 设计开发变更 | `/design-changes` | : page:design-changes | [定义](../../src/app/routesConfig.tsx#L175) |
| 文件与知识 | 报关单证 AI | `/customs-ai` | : page:customs-ai | [定义](../../src/app/routesConfig.tsx#L181) |
| 文件与知识 | 报关单证处理 | `/customs-docs` | : page:customs-docs | [定义](../../src/app/routesConfig.tsx#L182) |
| 文件与知识 | 对外资料版本 | `/external-docs` | : page:external-docs | [定义](../../src/app/routesConfig.tsx#L183) |
| 文件与知识 | 法规知识库 | `/ra-knowledge` | : page:ra-knowledge | [定义](../../src/app/routesConfig.tsx#L184) |
| 文件与知识 | 质量文件 DMS | `/quality-dms` | : page:quality-dms | [定义](../../src/app/routesConfig.tsx#L185) |
| 文件与知识 | 全链路追溯 | `/qa-traceability` | : page:qa-traceability | [定义](../../src/app/routesConfig.tsx#L186) |
| 订单与库存 | 订货单处理工作台 | `/order-workbench` | : page:order-workbench | [定义](../../src/app/routesConfig.tsx#L192) |
| 订单与库存 | 采购订单 | `/purchase-orders` | : page:purchase-orders | [定义](../../src/app/routesConfig.tsx#L193) |
| 订单与库存 | 库存管理 | `/inventory-management` | : page:inventory-management | [定义](../../src/app/routesConfig.tsx#L194) |
| AI 创作 | AI 图像生成 | `/ui-design` | : page:ui-design | [定义](../../src/app/routesConfig.tsx#L200) |
| AI 创作 | 图像作品库 | `/image-library` | : page:image-library | [定义](../../src/app/routesConfig.tsx#L201) |
| AI 创作 | 视频作品库 | `/video-library` | : page:video-library | [定义](../../src/app/routesConfig.tsx#L202) |
| 沟通协同 | 多渠道询盘 | `/inquiry` | : page:inquiry | [定义](../../src/app/routesConfig.tsx#L208) |
| 沟通协同 | 会议纪要 | `/meeting` | : page:meeting | [定义](../../src/app/routesConfig.tsx#L209) |
| 沟通协同 | 邮件 AI 写作 | `/email-ai` | : page:email-ai | [定义](../../src/app/routesConfig.tsx#L210) |
| 沟通协同 | 汇报材料压缩 | `/report-compression` | : page:report-compression | [定义](../../src/app/routesConfig.tsx#L211) |
| 人事与行政 | 简历筛选 | `/resume-screening` | : page:resume-screening | [定义](../../src/app/routesConfig.tsx#L217) |
| 人事与行政 | 应聘登记 | `/applicant-forms` | : page:applicant-forms | [定义](../../src/app/routesConfig.tsx#L218) |
| 人事与行政 | 员工入职归档 | `/employee-archive` | : page:employee-archive | [定义](../../src/app/routesConfig.tsx#L219) |
| 人事与行政 | 人员考勤 | `/attendance` | : page:quick-capture | [定义](../../src/app/routesConfig.tsx#L220) |
| 人事与行政 | 费用报销统计 | `/expense-center` | : page:expense-center | [定义](../../src/app/routesConfig.tsx#L221) |
| 质量与生产 | 生产驾驶舱 | `/production-dashboard` | : page:rd-director-dashboard | [定义](../../src/app/routesConfig.tsx#L228) |
| 质量与生产 | 生产计划与执行 | `/production-execution` | : page:production-execution | [定义](../../src/app/routesConfig.tsx#L229) |
| 质量与生产 | 生产领料 | `/warehouse-flow` | : page:warehouse-flow；Any: ["page:warehouse-flow", "page:production-execution"] | [定义](../../src/app/routesConfig.tsx#L230) |
| 质量与生产 | 电子批记录 | `/ebpr` | : page:ebpr | [定义](../../src/app/routesConfig.tsx#L231) |
| 质量与生产 | 检验与放行 | `/inspection-release` | : page:inspection-release | [定义](../../src/app/routesConfig.tsx#L232) |
| 质量与生产 | BUG 日志分析 | `/bug-log` | : page:bug-log | [定义](../../src/app/routesConfig.tsx#L233) |
| 法务管理 | 合同 AI 审查 | `/contract-review` | : page:contract-review | [定义](../../src/app/routesConfig.tsx#L239) |
| 系统运维中心 | 运维总览 | `/ops-center` | : page:ops-center | [定义](../../src/app/routesConfig.tsx#L245) |
| 系统运维中心 | 接口与错误 | `/ops-center/api-errors` | : page:ops-api-errors | [定义](../../src/app/routesConfig.tsx#L246) |
| 系统运维中心 | 数据库监控 | `/ops-center/database` | : page:ops-database | [定义](../../src/app/routesConfig.tsx#L247) |
| 系统运维中心 | 服务与任务 | `/ops-center/services-tasks` | : page:ops-services-tasks | [定义](../../src/app/routesConfig.tsx#L248) |
| 系统运维中心 | 告警与审计设置 | `/ops-center/alerts-audit` | : page:ops-alerts-audit | [定义](../../src/app/routesConfig.tsx#L249) |
| 系统管理 | 电子闸门 | `/electronic-gate` | : page:electronic-gate | [定义](../../src/app/routesConfig.tsx#L255) |
| 系统管理 | 设备检测记录 | `/device-inspection-records` | : page:device-inspection-records | [定义](../../src/app/routesConfig.tsx#L256) |
| 系统管理 | 邮箱管理 | `/mailbox-management` | : page:mailbox-management | [定义](../../src/app/routesConfig.tsx#L257) |
| 系统管理 | AI模型管理 | `/ai-model-management` | : page:ai-model-management | [定义](../../src/app/routesConfig.tsx#L258) |
| 系统管理 | AI使用情况 | `/ai-usage` | : page:ai-usage-dashboard | [定义](../../src/app/routesConfig.tsx#L259) |
| 系统管理 | 运营素材管理 | `/content-slots` | : page:content-slots | [定义](../../src/app/routesConfig.tsx#L260) |
| 系统管理 | AI使用与反馈 | `/chat-analytics` | : page:chat-analytics | [定义](../../src/app/routesConfig.tsx#L261) |
| 系统管理 | 翻译管理 | `/i18n-management` | : i18n:manage | [定义](../../src/app/routesConfig.tsx#L262) |
| 系统管理 | 腾讯OCR配置 | `/ocr-config-management` | : page:ocr-config-management | [定义](../../src/app/routesConfig.tsx#L263) |
| 系统管理 | 下载和教程 | `/downloads` | : page:downloads | [定义](../../src/app/routesConfig.tsx#L264) |
| 系统管理 | 操作手册 | `/manual` | : page:manual | [定义](../../src/app/routesConfig.tsx#L265) |
| 系统管理 | 部门管理 | `/departments` | : page:departments | [定义](../../src/app/routesConfig.tsx#L266) |
| 系统管理 | 用户管理 | `/users` | : page:users | [定义](../../src/app/routesConfig.tsx#L267) |
| 系统管理 | 角色权限 | `/roles` | : page:roles | [定义](../../src/app/routesConfig.tsx#L268) |
| 系统管理 | 操作留痕 | `/audit-log` | : page:audit-log | [定义](../../src/app/routesConfig.tsx#L271) |
| 系统管理 | 页面路由管理 | `/route-management` | : page:route-management | [定义](../../src/app/routesConfig.tsx#L272) |
| 系统管理 | 字典列表 | `/settings` | : page:settings | [定义](../../src/app/routesConfig.tsx#L273) |


## 实际第三级：不是一棵统一菜单树

当前侧栏只定义“分组 → 菜单项”。以下是用户进入菜单后遇到的业务层级；Tab、筛选与弹层不能混称三级菜单。

| 二级入口 | 当前第三级或下一层 | 承载方式与上下文 |
| --- | --- | --- |
| 系统首页 | 研发/问题/费用/订货单待办 | 卡片或队列跳业务页面；不是覆盖所有业务的全站工作台 |
| 研发任务驾驶舱 | 产品/系统/子系统、任务、人员、日报/月报/绩效等 | 类目树、统计下钻、面板与弹窗；任务可进入独立详情 |
| 研发个人工作台 | 主责/协助；任务详情、任务讨论、更新进度、移交协作、提交结果 | 角色 Tab + 任务操作弹层内 Tab；转采购再开专用表单 |
| 中美协同驾驶舱/工作台 | 同一类任务操作；协同详情 | 复用研发协作模式，单独工作区、知识库和授权；驾驶舱隐藏子系统全景 |
| 供应链任务驾驶舱 | 采购任务 / 样品协同 / 备货计划 | 三个 Tab；任务详情 Drawer；计划内还有采购批次表单 |
| 采购个人工作台 | 本人采购任务、样品、相关备货、待到货来源；交期视图 | 任务列表与摘要、聚合组件、日历/甘特；订单行可跨页定位并返回 |
| 我的仓管与质量任务 | 收货 / 质量待办、任务分派与历史 | 本人岗位队列；处理返回采购订单的原行/原收货批次 |
| 物料库 | 物料详情、分类管理、AI 分类、安全库存、T+ 集成 | 详情 Drawer；后四类在“更多管理”下进入各自操作 |
| 全部关键物料 | 原始线索映射 / 月度核对与物料详情 | 线索目录与月度面板，正式料号是关联点，不是独立物料账 |
| 库存齐套中心 | 型号/BOM、库存/在途依据、缺口、下单日期检查 | 同页计算与明细；可跳物料、订单行、备货计划 |
| 供应商报价库 | 按物料比价 / 按供应商查看 | 同对象的两种视图；商品/供应商报价 Drawer、导入 Modal |
| 采购订单 | 单据详情 → 商品行 → 收货/检验、交期、履约、日期历史 | 独立详情 + 行级 Drawer/Modal；列表与详情权限分别控制 |
| 库存管理 | SKU 多仓详情 | 列表 + 详情；T+ 镜像只读 |
| 生产驾驶舱 | 生产计划与办理 / 其他生产协同任务 | 前者进入正式执行，后者进入同路由的 legacy 视图 |
| 生产计划与执行 | 批次与派工 / 现场作业 / 齐套与占用 / 转产与 ECN / 放行与发货 / 批次档案 / 进展留痕 | 最多七个 Tab（齐套与占用受权限控制）；按月、产品与计划选择上下文；操作再开表单 |
| 生产领料 | 发料签收、其他领料/退料/盘点、ERP 凭证核对 | 同页原单列表、业务记录面板和操作表单；实际标题比菜单更广 |
| 知识库 | 研发库及 13 个部门库 → 类目 → 文件 | 库下拉切换、类目树、列表/网格、预览及上传；部门库深链保留 |
| 对外资料版本 | 资料 → 基准/候选版本 → 差异复核 → 归档 | 同页主从与文件预览；不是多个菜单页 |
| 问题记录与 AI 定位 | 清单 → 新建两步 Drawer → 问题详情 | 详情由 URL ?issue= 指定；分析、方案、对话及留痕在同一问题下 |
| 应聘登记 | 表单模板 / 登记记录 / 发布历史 | Tab；模板编辑、手机预览、发布确认；外部填写为独立公开页 |
| 员工入职归档 | 员工档案、材料缺项、转正、胸牌制作 | 列表/详情与长表单；胸牌编辑含版式参数，不是独立菜单 |
| 人员考勤 | 月度、日记录、人员详情、加班/结余 | 月份及业务视图；补录 Modal、导入 Dialog、正式导出 |
| 费用报销统计 | 凭证管理 / 归档分类 / 审批流 / 发票回购 / 统计分析 | Tab；票据详情、影像与报销长表单各有弹层 |
| AI模型管理 | 模型连接 / 路由策略 / 运行监控 / 请求明细 | 页内工作区 Tab；从监控下钻请求、连接测试/配置 Modal |
| 电子闸门 | 检测规则 / 人工确认 / 连接参数 / 读取协议 / 返工指令 | 五个 Tab；配置项独立保存/发布，协议还有草稿与历史 |
| 操作留痕 | 模块、动作、对象、来源、操作人 | 筛选维度，不能再算研发/采购/协同三个页面 |
| 页面路由管理 | 页面权限 / 按钮权限、导航显示/隐藏 | 权限目录筛选与编辑；不是业务菜单编辑器的完整替代 |
| 下载和教程 / 操作手册 | 平台教程 / 主题内容 | 独立子路由，沿用父页面权限 |

证据：[研发工作台](../../src/app/RDMyWorkspacePage.tsx)、[采购驾驶舱](../../src/app/procurement/ProcurementCockpitPage.tsx)、[订单详情](../../src/app/order-processing/pages/PurchaseOrderDetail.tsx)、[生产执行](../../src/app/production/execution/ProductionExecutionPage.tsx)、[费用](../../src/modules/expense/pages/ExpenseModule.tsx)、[电子闸门](../../src/app/ElectronicGatePage.tsx)。Tab 文案的差异与建议统一名称见文末及 [05](05-ux-problems.md)。

## 全局入口与辅助路径

- 实际桌面外壳是 Root + sidebar_1 + header_1；同目录旧 Sidebar/Header 文件不是当前导航依据。
- 顶栏有页面搜索、MateChat、消息预览、语言与个人菜单。研发类驾驶舱场景会把搜索改为任务搜索，搜索范围随页面变化。
- /profile 与 /message-center 不占侧栏菜单；任意登录用户可进外壳，内容继续受业务范围约束。
- /rd-task/:taskId、/us-collab-task/:taskId、/production-task/:taskId 是任务详情；/rd-discussion/:taskId 与 /us-collab-rd-discussion/:taskId 是受邀讨论入口。讨论不等于获授完整任务池权限。
- /rd-people-management、/us-collab-people-management、/production-people-management 从任务工作区进入；采购人员页 /proc-people-management 从供应链驾驶舱进入。
- /dept-kb 是聚合入口；/dept-kb/:id 与 /rd-knowledge-base 是可刷新/分享的库地址。协同库 /us-collab-kb 仍独立。
- 兼容路径：/quick-capture → /attendance；/rd-director-dashboard → /production-dashboard；rd/proc/us-collab-audit-log → /audit-log 并预选模块。它们不是新业务页面。
- /__preview 及其 17 个子入口仅 DEV 可达；无正式侧栏菜单。详见 [03 路由表](03-page-inventory.md)。

## 移动端地图与任务连续性

| 入口 | 当前行为 | 产品意义 |
| --- | --- | --- |
| /m、/m/task/:taskId | 研发移动任务总览/详情 | 不是全部业务的移动首页 |
| /us-collab-m、/us-collab-m/task/:taskId | 协同工作区移动总览/详情 | 保留工作区隔离 |
| /production-m、/production-m/task/:taskId | 生产协同任务池移动视图 | 与正式生产计划执行不是同一工作面 |
| 移动 discussion / chat-analytics | 讨论线程、AI 采用与反馈 | 独立适配；讨论需符合受邀/任务范围 |
| 采购工作台/驾驶舱、物料、关键物料、齐套、订单列表详情、岗位待办 | ProtectedLayout 明确豁免自动跳转 | 在原业务路由使用窄屏布局 |
| 应聘管理、公开填写、生产执行、领料 | 保留原页面或独立公开页 | 并非都走 MobileRDCockpit |
| 研发工作台携带 ?sampleTest= | 专用 MobileProcSampleTestPage | 测试人可在原工作流完成样品测试 |
| 其他未豁免的受保护桌面页 | 窄屏自动转工作区移动首页，默认 /m | 非研发任务可能丢失原页面目标，是应优先实测的跨端问题 |

依据：[ProtectedLayout](../../src/app/App.tsx#L380)、[mobileRouting](../../src/app/lib/mobileRouting.ts)、[MobileShell](../../src/app/MobileShell.tsx)。进入手机模式的阈值与 Root 的侧栏折叠阈值不是同一个概念。不能将“手机有菜单”理解为所有页面都有可用的手机业务闭环。

## 命名一致性核对

| 当前菜单/入口 | 页内标题或能力 | 判断与建议词汇（尚未修改） |
| --- | --- | --- |
| 两个“个人工作台” | 研发任务工作面；“采购工作台” | 导航搜索结果需带业务前缀；统一为“研发工作台”“采购工作台” |
| 系统首页 | “我的工作台”，只聚合已接入部分业务 | 明确个人范围和来源覆盖，避免与两种个人工作台同名竞争 |
| 生产驾驶舱 | “生产总览与现场待办”；legacy 为生产协同 | 主入口可称“生产总览”；旧模式明确“生产协同任务” |
| 生产领料 | “仓库领退料与盘点” | 菜单范围窄于实际功能；候选名“仓库办理” |
| 全部关键物料 | “关键物料”，31 条会议线索映射 | “全部”指线索目录，不是企业全量 SKU；标明当前目录范围 |
| 费用报销统计 | “费用与报销工作台”，含提交、审批、归档 | 候选名“费用与报销”，统计保留 Tab |
| 视频作品库 | “AI 视频创作”，含生成与作品库 | 候选名“视频创作”；与图像的生成/作品结构保持同一规则 |
| 角色权限 | “角色与权限” | 统一标题、面包屑和菜单 |
| 页面路由管理 | 页面/动作权限目录、路径、导航隐藏 | 候选名“权限与页面目录”，不要让管理员误认为只改 URL |
| 字典列表 | 枚举、基础数据、邮箱账号 | 基础数据与连接配置分离；页面名称不能掩盖凭据管理职责 |
| 报关单证处理 | “报关单证自动处理”；报关 AI 功能重叠 | 以“报关单证”作为统一业务入口，上传/复核/生成是流程阶段 |
| 售后 Case 管理 | “售后工单”；详情又叫 Case 摘要 | 中文主名称统一“售后工单”，Case 可作辅助词 |
| 多渠道询盘 | “海外询盘与商机” | 先确认业务是否仅海外，再统一范围 |
| 质量文件 DMS | “质量文件管理系统” | 主名“质量文件”，DMS 作为简称 |
| AI模型管理 / AI使用情况 / 腾讯OCR配置 | 页内多为带空格的“AI 模型”“AI 使用”“腾讯 OCR” | 统一中英文空格及“使用情况/采用反馈/运行监控”的指标归属 |
| 运维错误分析提示 | 指向“集成管理 → AI 模型”，侧栏无“集成管理”分组 | 提示应指向当前真实入口；不是用户漏找菜单 |
| 更新进度 / 进展留痕 / 提交结果 / 标记完成 | 部分是事实记录，部分发起审核或直接完成 | 不机械统一为“完成”；明确动作后状态及是否需要审批 |
| 转派 / 移交 / 移交协作 | 负责人变化、协作人变化在不同页面混用 | 建议固定“变更主责人”“调整协作人”，保留不同审批规则 |

## 信息架构候选方向

这不是视觉重设计，也不是迁移方案。后续验证可按“我的工作、研发协作、供应链、生产与质量、客户与订单、知识与受控资料、人事与费用、AI 工具、平台管理”组织讨论，但不要求把所有模块硬塞入这九组。

确定性较高的归位：采购订单/库存与供应链放在同一业务域；设备检测记录归质量；电子闸门作为质量配置；下载/手册作为全局帮助；研发审批/AI 策略作为工作区设置。跨域任务使用原对象链接和返回上下文，不能通过复制同一单据来“打通导航”。
