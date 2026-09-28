# 04 · 功能、对象与核心任务地图

审计日期：2026-09-17。本文件将页面还原为用户任务、业务对象、状态与系统边界。页面覆盖见 [03](03-page-inventory.md)，问题判断见 [05](05-ux-problems.md)。

## 功能树：以业务对象为中心

| 对象/能力域 | 获取与建立 | 办理与协作 | 产出与查证 | 权威边界 |
| --- | --- | --- | --- | --- |
| 研发/协同任务 | 人工创建、AI 立项、层级归类、主责与协作 | 进展、讨论、阻塞、延期/协作变更、转派、提交/审核 | 技术资料、过程报告、知识沉淀、操作记录 | 按 workspace 隔离；报告和工作台是任务投影 |
| 问题 | 手工描述/附件、研发关联、历史相似查找 | AI 根因/方案、补充线索、采纳、解决 | 问题版本、对话与可复用方案 | /issue-ai 已接真实问题服务；旧分流/BUG 页面尚非同一数据链 |
| 采购任务 | 手建需求、研发交付与审批、匹配物料 | 接收、报价、选价、样品、关联下单、到货、转派/回退 | 采购进度、报价快照、交付/样品记录 | 不等同 ERP 采购订单；一个任务可关联多个原订单行 |
| 样品轮次 | 需求/报价条件、实际到样、测试人分派 | 实际开测/结束、结论、失败重送、轮次更正 | 当前结论、轮次历史、本轮采购条件、技术文件 | 指定测试人负责结论；旧失败轮次不能当作本轮到样或通过 |
| 物料 | 正式编码、规格、单位、分类、供应来源 | 库存风险、关键线索映射、BOM 关联、报价 | 正式物料详情、库存与订单依据 | 线索、SKU、BOM 行、报价商品不能仅按同名合并 |
| 报价 | 录入/导入/OCR、物料/供应商关联 | 按物料比较、供应商查看、有效期与条件 | 选中报价快照、历史、导出 | 币种、起订、单位、有效期与采购条件影响“最低价”的含义 |
| 备货计划 | 按月/产品/整机或物料确认需求 | 分批采购、原订单行关联、到货/合格/下单核对 | 计划达成、日期差异、关联订单 | 备货目标不能自动当成正式生产目标 |
| 采购订单行 | T+ 同步订单及数量 | 承诺与改期、人工可用日期、收货/检验、履约调整与独立审批 | 净履约/检验可用、历史、受影响计划 | ERP 镜像 + 本地补充台账；本地确认不直接写 ERP |
| 仓库 | 生产派工需求、其他领料/退料/盘点原单 | 发料、签收、实物分类、盘点确认、ERP 凭证核对 | 未核对占用、原单操作历史 | 实物交接、ERP 主账和可用量必须分别说明 |
| 生产计划/批次/作业 | 月生产/发货目标、BOM、拆批、编制作业 | 派工、领料、报工、初检、不良/复验 | 产量、良品、完成依据、批次档案 | 组件单位与整机台数分开；报工良品不等于 QA 放行 |
| 转产资料/ECN | 关联样品轮次、SOP/SIP/图纸与版本 | 独立验证、发布、适用批次、生效与岗位确认 | 固定版本、执行依据及历史 | 研发探索记录不能自动成为量产依据 |
| 质量放行/发货 | 从批次检验结果与未闭环异常检查 | QA 放行、实际发货、凭证冲销 | 放行数、净发货、追溯档案 | 初检、复验、放行、出货不能重复计数 |
| 知识文件 | 上传/任务入库、库与分类、密级 | 搜索、预览、编辑/移动、成员分值 | 下载、RAG 检索、资料包 | 部门库/研发库/协同库仍独立授权 |
| 对外资料版本 | 首版、候选版及文件身份 | AI/OCR 比对、逐项人工复核、替换候选/重试 | 归档摘要、锁定版本、证据定位 | 文档内容的受控版本与一般知识文件不同 |
| 候选人/登记/员工 | 简历导入、岗位筛选、公开登记、员工建档 | AI 初筛/二筛、人工跟进、登记状态、缺项/转正 | 简历结论、登记版本、正式员工档案 | 当前不能据页面相邻假定候选人与员工自动一键转档 |
| 考勤 | 员工档案、考勤导入、日期班次 | 预览核对、补录、加班/倒挂/调休及月度确认 | 正式考勤导出 | 人员长期设置与本月字段应区分 |
| 费用/凭证/报销 | 发票/报销凭证上传、OCR 与人工修正 | 匹配付款凭证、分类归档、新建报销、企业微信审批 | 审批状态、统计与回购明细 | 识别、付款证据和审批是三种事实 |
| 客户订货单/发票 | 业务邮箱或手动文件上传 | 解析商品、核对金额、模板与发票编辑 | 发票生成、PDF 导出 | 客户订货单不是供应商采购订单 |
| AI 会话/作品 | 对话、图片/视频提示、附件 | 生成、编辑、引用、工具建议与用户确认 | 会话、作品、反馈、文件包、结项资料检查 | AI 建议不是自动批准的业务动作；成本统计是估算 |

## 页面 → API → 业务来源

以下为功能契约族，不是接口测试报告。前缀与能力来自前端调用及后端控制器，未调用生产数据接口。

| 前端工作面 | 主要接口族 | 对用户有意义的读写/来源 | 证据 |
| --- | --- | --- | --- |
| 登录、个人中心 | /api/auth | 登录、当前账号、头像、资料与密码 | [auth](../../src/app/auth.tsx)、[auth controller](../../apps/api/src/modules/auth/auth.controller.ts) |
| 首页 | 多模块聚合 + /api/health | 当前权限可见的研发、问题、费用、订货队列与加载健康 | [dashboardApi](../../src/app/lib/dashboardApi.ts) |
| 研发/协同/生产协作 | /api/research-development | 任务、工作项、人员、报告、审批、消息、数据表、配置；workspace 决定数据池 | [rdApi](../../src/app/lib/rdApi.ts)、[controller](../../apps/api/src/modules/research-development/research-development.controller.ts) |
| AI 立项/研发处理 | /api/research-development/ai | 文件/描述提取、建议整理与分类，用户确认后写入任务 | [rd-ai controller](../../apps/api/src/modules/research-development/rd-ai.controller.ts) |
| 技术资料 | /api/research-development/tasks/:taskId/technical-documents | 任务技术文件和版本 | [rdTechnicalDocumentsApi](../../src/app/lib/rdTechnicalDocumentsApi.ts) |
| 知识库 | research-development/knowledge、dept-knowledge/:kbId；/api/rag | 分类/条目/上传/密级、检索与问答 | [RDKnowledgeBase](../../src/app/RDKnowledgeBasePage.tsx)、[dept controller](../../apps/api/src/modules/research-development/dept-knowledge.controller.ts)、[ragApi](../../src/app/lib/ragApi.ts) |
| 问题 AI | /api/issues | 新建、相似方案、分析、调整、聊天、采纳、解决、统计 | [issueHttpService](../../src/app/lib/issue/issueHttpService.ts)、[controller](../../apps/api/src/modules/issue/issue.controller.ts) |
| 采购任务/物料/备货/样品 | /api/procurement | 任务状态、报价选择、物料、BOM、备货批次、样品分派/时间/结论 | [procurementApi](../../src/app/lib/procurementApi.ts)、[controller](../../apps/api/src/modules/procurement/procurement.controller.ts) |
| 报价库 | /api/procurement/quote-book | 多供应商价格/条件、导入、OCR、按物料身份查历史 | [quote controller](../../apps/api/src/modules/procurement/quote-book.controller.ts) |
| 关键物料 | /api/procurement/key-materials | 线索→正式物料映射、依据历史、月度视图 | [keyMaterialsApi](../../src/app/lib/keyMaterialsApi.ts) |
| 仓管/质量岗位任务 | /api/procurement/operational-tasks | 按原订单行/收货批次派生个人/团队队列，分派与历史 | [operationalTasksApi](../../src/app/lib/operationalTasksApi.ts) |
| 采购订单/库存/T+ | /api/procurement/tplus，含 views | 状态、同步、ERP 镜像订单/库存；凭据为管理能力 | [orderProcessingApi](../../src/app/lib/orderProcessingApi.ts)、[tplus controller](../../apps/api/src/modules/procurement/tplus-sync.controller.ts) |
| 交期 | /api/procurement/delivery | 原始承诺、改期/撤销、ERP 观察历史、排期 | [purchaseDeliveryApi](../../src/app/lib/purchaseDeliveryApi.ts) |
| 收货与检验 | /api/procurement/purchase-order-lines/:lineId/receipts | 分批实收、收货批次内质量判定 | [purchaseReceiptApi](../../src/app/lib/purchaseReceiptApi.ts) |
| 履约调整 | /api/procurement/purchase-order-lines/:lineId/fulfillment | 取消/退货/冲销/ERP 覆盖提案、批准/撤销、净量与计划重算 | [purchaseFulfillmentApi](../../src/app/lib/purchaseFulfillmentApi.ts) |
| 子系统报工/质量 | /api/procurement/operations | 正式报工、质量异常与复验等原始记录 | [procurementOperationsApi](../../src/app/lib/procurementOperationsApi.ts) |
| 正式生产总览/计划执行 | /api/procurement/production-execution | 月计划、批次、派工、报工与初检、概览 | [productionExecutionApi](../../src/app/lib/productionExecutionApi.ts)、[controller](../../apps/api/src/modules/procurement/production-execution.controller.ts) |
| 转产/ECN/放行/发货/齐套 | production-execution/:id/lifecycle、readiness | 原计划上下文内动作、库存占用/线边确认、快照、档案 | [productionLifecycleApi](../../src/app/lib/productionLifecycleApi.ts) |
| 仓库办理 | /api/procurement/warehouse-flow、warehouse-records | 领料动作/签收/ERP 对账及其他仓库记录 | [warehouseFlowApi](../../src/app/lib/warehouseFlowApi.ts)、[warehouseRecordsApi](../../src/app/lib/warehouseRecordsApi.ts) |
| 设备规则与检测证据 | /api/electronic-gate、electronic-gate/factory-qc、device-inspection-records | 后台规则/协议发布、客户端配置下载、设备结果上传/查询 | [gate API](../../src/app/lib/electronicGateApi.ts)、[record API](../../src/app/lib/deviceInspectionRecordsApi.ts)；公共客户端接口不属于菜单 |
| 对外资料 | /api/external-docs | 文件解析、比对任务、复核、重试、候选纠正、归档与下载 | [externalDocsApi](../../src/app/lib/externalDocsApi.ts) |
| 简历 | /api/recruitment | 简历/邮件队列、岗位规则、后台初筛/二筛任务及候选人跟进 | [recruitmentApi](../../src/app/lib/recruitmentApi.ts) |
| 应聘登记 | /api/applicant-forms、/api/public/applicant-forms | 内部模板/版本/记录；外部加载/上传/提交 | [applicantFormsApi](../../src/app/lib/applicantFormsApi.ts) |
| 员工/考勤 | /api/employee-archives、/api/attendance | 人员建档、材料/胸牌、转正；考勤预览/确认/补录/汇总 | [employeeArchiveApi](../../src/app/lib/employeeArchiveApi.ts)、[attendanceApi](../../src/app/lib/attendanceApi.ts) |
| 费用 | /api/expenses | OCR、发票/凭证、匹配、报销、企微集成、归档与统计 | [expenseService](../../src/modules/expense/services/expenseService.ts)、[controller](../../apps/api/src/modules/expense/expense.controller.ts) |
| 客户订货单 | /api/order-processing | 上传/邮箱同步、订单、模板/发票生成、导出 | [orderProcessingApi](../../src/app/lib/orderProcessingApi.ts) |
| MateChat | /api/chat、chat/delivery-checks 及归档子接口 | 会话/消息、上下文、工具执行确认、反馈、文件检索与后台资料包 | [MateChat](../../src/app/components/MateChatBubble.tsx)、[chat controller](../../apps/api/src/modules/chat/chat.controller.ts) |
| 图像/视频 | /api/image-generation、/api/video-generation | 同步/异步生成、任务轮询、作品库/分类、上传、调用成本 | [UIDesign](../../src/app/UIDesignPage.tsx)、[videoGenerationApi](../../src/app/lib/videoGenerationApi.ts) |
| 模型/邮箱/OCR 与 AI 路由 | /api/integration-management、/api/ai-gateway | 服务连接凭据与测试；场景路由、运行记录和熔断 | [integrationManagementApi](../../src/app/lib/integrationManagementApi.ts) |
| AI 统计/反馈/素材 | /api/ai-usage、chat/analytics、chat/feedback、content-slots | 成本、采用、反馈、自动内容位配置与预算 | 对应 aiUsageApi、chatAnalyticsApi、contentSlotsApi |
| 治理/运维 | /api/users、roles、departments、permission-catalog、dictionaries、i18n、audit、ops-center、settings | 身份、授权目录、基础数据、翻译、审计与运行信息 | 对应 lib 与后端控制器；settings 接口存在不代表当前有通用设置页 |
| 跨业务文件 | /api/files | 授权上传/登记、临时访问链接、预览/下载 | [resourceUpload](../../src/app/lib/resourceUpload.ts)、[resourceAccess](../../src/app/lib/resourceAccess.ts) |

## 权限不是单一“能看页面”

用户完成任务至少经过四种判断：登录 → 页面权限 → 对象/工作区范围 → 当前状态下的动作权限。菜单隐藏还增加第五种“是否容易找到”，但不会撤销链接访问权。

| 典型任务 | 页面与动作/对象条件 | 对体验的含义 |
| --- | --- | --- |
| 查看订单并收货 | 订单详情页面权限；proc-purchase-order:receive；原订单/行范围 | 能看列表不保证能进详情；能进详情不保证能登记 |
| 查看本人仓管/质量待办 | page:purchase-order-detail，加收货/检验/采购驾驶舱权限任一；页面内部与服务端再限本人 | 原 App 外层只有第一道门，不能只读路由就宣布守卫不一致 |
| 研发成果审核 | 工作区页面、审核权限、实际审核池与当前任务状态 | “提交结果”与“审核通过”应分别命名与计步 |
| 样品结论 | 当前有效轮次、指定测试人、测试权限/时间要求 | 采购安排测试，不能默认代填研发结论 |
| 履约调整批准 | 调整提案权限与 approve-fulfillment 分离，独立批准及记录 | 审批交接是必要责任边界，不应为了缩短点击取消 |
| 知识库资料 | 库页面码、文件密级/成员分值、操作码 | 聚合入口必须保留库边界与无权提示 |
| 受邀讨论 | 登录与线程授权 | 不应要求受邀人获得全部任务池权限才能讨论 |
| 生产生命周期 | 计划/报工/检验/转产/放行/发货分别授权与范围判断 | 需要按岗位进入任务，而非要求各岗位理解整个七 Tab 页面 |

后端通用 RolesGuard 多权限为 OR，个别业务的 All/所有者/状态限制由服务逻辑实现。此处说明产品可达性，不对权限安全作审计结论。

## 核心任务需要多少步骤

### 计数口径

起点为已登录桌面用户，侧栏分组已展开，具备所需权限，数据正常。每次进入页面、打开对象/操作面、切换必要阶段、完成一组表单、提交或确认，记一个**任务步骤**。输入多个字段作为一组；检索筛选若额外需要，另加 1–2 步。系统加载/AI 等待、审批等待、线下操作均不算点击，但记录为等待/交接。以下是明确选择的一条常见路径，不宣称是所有入口的最短路径。

| 核心任务 | 编号步骤（与总数一一对应） | 基线步骤/交接 | 结果与边界 |
| --- | --- | --- | --- |
| 提交一项研发成果 | ①进入研发工作台 → ②打开任务操作面 → ③切“提交结果” → ④整理说明/交付物 → ⑤提交 → ⑥在确认层确认 | 6；后续 1 次审核交接 | 进入审核，不代表完成验收；主管直办路径可能不同 |
| 更新研发进度 | ①工作台 → ②任务 → ③“更新进度” → ④填写说明/附件 → ⑤请求 AI 判断 → ⑥复核并应用建议/必要时修改 → ⑦保存 → ⑧确认保存 | 8；含 AI 等待 | 本次按“使用 AI 判断”路径；无 AI 或直接手动路径应另测 |
| 研发转采购申请 | ①研发工作台 → ②任务 → ③转采购 → ④填写需求并选图纸/附件 → ⑤提交申请 | 5；至少研发→审核方→采购两次角色交接 | 审核通过才进入采购处理；本机草稿可恢复；下游不是本次提交即完成 |
| 接收采购任务 | ①采购工作台 → ②选择待处理任务 → ③点当前下一步按钮 → ④确认接收 | 4；无额外跨页 | 卡片当前写“确认提交”，弹窗写“确认接收”，有动作语义摩擦 |
| 选择采购报价 | ①采购工作台 → ②选待询价任务 → ③选择报价 → ④检索/比较并勾选有效报价 → ⑤确认报价 | 5 | 进入询价状态；不代表已购买；无报价时须另去录入/导入 |
| 登记一次订单行收货 | ①我的仓管与质量任务 → ②进入原订单 → ③打开目标行收货 → ④填写本次实收/依据 → ⑤提交 | 5；后续交质量 | 不是“采购已完成”；需区分实收、检验可用与 ERP 同步 |
| 记录订单行承诺变更 | ①采购订单列表 → ②单据详情 → ③行级交期 Drawer → ④打开承诺登记 → ⑤填写新日期/原因/凭据 → ⑥提交 | 6 | 旧承诺保留，ERP 当前日期不替代供应商承诺 |
| 发布并填写应聘表单 | ①应聘登记 → ②选模板 → ③编辑字段与要求 → ④保存草稿 → ⑤点发布 → ⑥确认发布 → ⑦复制正式链接 | HR 7；链接交接给候选人 | 外部另计：①打开链接 ②填写各阶段 ③提交；阶段数/附件会增加实际步数；复制不等于已发送 |
| 导入并筛选简历 | ①简历筛选 → ②选岗位/模型等上下文 → ③选上传文件入口 → ④选择文件并启动上传 → ⑤待后台完成后筛选/打开候选人 → ⑥人工复核结论 | 6；含后台等待 | 新建岗位规则、二次筛选或候选状态更新另计；AI 分数不是录用决定 |
| 处理外部资料新版本 | ①对外资料版本 → ②选资料 → ③上传新版本 → ④选文件/补版本并提交 → ⑤等比对后逐项复核 → ⑥核对归档摘要 → ⑦发起归档 → ⑧确认归档 | 8；差异逐项处理为循环 | 未把每条差异点击算入 8；差异数量决定主要成本 |
| 处理客户订货单 | ①订货单工作台 → ②上传订货单 → ③选文件并上传 → ④选择解析后的订单 → ⑤核对商品/发票信息 → ⑥生成发票 → ⑦导出 PDF | 7；含解析等待 | 邮箱同步路径替代上传；模板缺失/异常修正另计 |
| 新建报销单并提交 | ①费用页 → ②审批流 Tab → ③新建报销单 → ④填申请/明细并选已识别票据 → ⑤核对并提交 | 基线 5；外部审批交接 | 票据上传/OCR/关联另计；草稿保存、企微配置或额外确认视路径增加步骤 |
| 查询一个 SKU 库存 | ①库存管理 → ②输入关键词并搜索 → ③打开 SKU 详情 | 3 | 同时想看 BOM 齐套或比价需跨页；库存查阅不应强制走采购任务 |
| 查看并使用知识文件 | ①知识库 → ②切换目标库 → ③选择类目/搜索 → ④预览文件 → ⑤下载/引用 | 5；默认库正确可减 1 | 无权文件不是“没有资料”；RAG 问答是另一条路径 |
| 生产报工 | ①生产计划与执行 → ②选择计划 → ③现场作业 Tab → ④目标作业“登记报工” → ⑤填写产量/良品/说明 → ⑥保存 | 6 | 从生产总览直接进入作业可缩短定位；报工后仍需质量流程 |
| 批次质量放行 | ①生产计划与执行 → ②选择计划 → ③放行与发货 Tab → ④目标批次“质量放行” → ⑤核对数量/档案依据 → ⑥保存 | 6；质量岗位责任 | 前提为检验与异常符合条件；不含前序处置/复验 |
| 实际发货登记 | ①生产计划与执行 → ②选择计划 → ③放行与发货 Tab → ④目标批次“实际发货” → ⑤填日期/数量/客户订单/凭证 → ⑥保存 | 6；仓库/业务协作 | 发货与放行各有独立事实；线下实物发运不计入 UI 步骤 |
| 修改模型连接并验证 | ①AI模型管理 → ②模型连接 Tab（非当前时） → ③编辑连接 → ④修改字段 → ⑤测试连通 → ⑥保存 | 6；默认 Tab 已对可减 1 | 与场景路由/研发策略不是同一份设置 |

依据：各流程对应 [03 页面清单](03-page-inventory.md) 的页面和表单；关键交互见 [任务工作台](../../src/app/RDMyWorkspacePage.tsx)、[转采购组件](../../src/app/procurement/components/rdInsertion.tsx)、[采购动作执行器](../../src/app/procurement/components/taskActions.tsx)、[公开登记说明](../applicant-forms.md)、[生产操作表单](../../src/app/production/execution/OperationalDialog.tsx)、[资料版本](../../src/app/ExternalDocsPage.tsx)。

### 跨角色链路不能简单等于点击总和

研发转采购至少跨提交人、审核人、采购负责人；需要样品时还跨测试人；实收/检验又跨仓管与质量。每位接手人需要“自己的队列 → 原对象 → 当前动作”。影响业务周期的往往是未及时交接、附件缺失与口径不明，不是多一次明确确认。

生产从零开始包含确认月目标、建批次、编作业、派工、发料、签收、报工、初检、必要的不良/复验、放行和发货。这里的 11 个业务阶段不是 11 次点击，也不是所有产品都相同的审批步骤。应按岗位分别验证，不能把整段都压成计划员的一张长表。

### 建议测量的实际指标

| 链路 | 验证指标 | 需要的测试证据 |
| --- | --- | --- |
| 找到本人下一件事 | 首次定位时间、错误入口次数、回首页次数 | 按研发/采购/仓管/质量分别观察，不能只测超级管理员 |
| 研发→采购→样品 | 首次提交材料完整率、退回率、交接等待、原任务返回成功 | 带真实授权的匿名化样例；失败、重送与草稿恢复 |
| 订单收货/可用 | 原订单行定位成功、误把实收当可用的次数 | 单位不同、部分到货、退货/冲销/待检验场景 |
| 生产执行 | 岗位进入正确 Tab 的时间、原单上下文丢失、放行/发货理解准确率 | 手机与桌面、不同角色、跨月计划 |
| 文件/知识 | 找到正确库和有效版本的成功率 | 有权限/无权限、旧版/候选版/已归档版 |
| 人事与报销 | 导入错误恢复、重复录入字段、提交成功与状态理解 | 表单版本、票据识别异常、外部审批失败 |

## 设置能力归属

| 配置对象 | 当前入口 | 应保留的产品边界 |
| --- | --- | --- |
| 身份与授权 | 部门、用户、角色、页面路由管理 | “组织人员”和“系统账号”关联但分责；权限目录与给角色授权分开 |
| 模型服务连接 | AI模型管理 | 连接可用性、平台路由与监控属于平台管理员 |
| AI 业务策略 | 研发/协同 AI 策略、简历岗位规则、各业务模型选择 | Prompt/阈值/业务规则属于业务负责人；仅引用获授权连接 |
| 邮箱与 OCR 凭据 | 邮箱管理、OCR 配置、字典 email 类型、业务内设置 | 凭据应有明确唯一管理源，业务页面选连接和运行方式 |
| ERP/T+ | 物料库“更多管理 → T+ 集成”、订单/库存同步 | 连接配置与日常刷新分开；同步不是人工改主账 |
| 审批流 | 研发/协同审批配置、费用集成与审批流视图 | 配置规则与处理审批待办分开；不同业务规则不可硬合并 |
| 检测标准与协议 | 电子闸门五 Tab | 草稿/独立发布/实际检测记录分离，保留历史标准 |
| 枚举与内容 | 字典、翻译、运营素材 | 枚举、界面语言和运营内容为不同对象，不合并成无边界“设置” |

## 组件承载原则

当前已有表格/卡片、主从页、业务 Drawer、Dialog、独立详情等多种模式。后续统一的是“何时用哪一种”，不是重写视觉组件：

- 独立页面：有稳定对象身份、长时间办理、可分享链接、多个子流程或多人交接，例如采购订单、研发任务、生产批次、候选人完整档案。
- Tab：同一对象/范围下的平行视图，例如同一任务的进展/讨论/资料，同一单据的明细/交期/履约。同一组件复用不构成合并为 Tab 的理由。
- Drawer：从列表快速看一个对象、行级记录和短操作，保留原筛选与选中上下文，例如订单行日期历史、物料摘要、人员任务列表。
- Modal：短小、边界清楚的一次性动作或明确确认，例如退回原因、改负责人、发布确认。长流程需要恢复/分享时应升级承载方式。
- 步骤流程：有前后依赖的录入→复核→提交，例如新建问题、转采购、资料归档。不要把有顺序的阶段伪装成任意切换 Tab。

具体页面合并、拆分与保留结论见 [05](05-ux-problems.md)。
