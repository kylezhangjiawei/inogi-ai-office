# V1.1 原型核对：供应链 S00–S08

核对日期：2026-09-20。范围为 9 个业务视图，不是要求新增 9 个菜单。仅阅读原资料、逐张查看高保真图片、核对当前前后端及运行已有自动化测试；本报告未操作浏览器、未修改业务代码。浏览器观感、真实账号权限及真实业务数据结果需结合主审现场记录。

## 依据与已接受差异

原资料目录：`C:/Users/Administrator/Documents/xwechat_files/zjw19920831_8887/msg/file/2026-09/INOGI_AI驾驶舱_V1.1全套开发资料_33页高保真/INOGI_AI驾驶舱_V1.1开发资料`。

本报告的“说明 Lxxx”均指该目录的 `INOGI_AI驾驶舱_V1.1开发说明.md`。已读取 `page_map.json` 的 S00–S08 映射、说明 L187–311 各页要求、L629–737 数据与计算口径、L843–874 验收条件。已用图像工具逐张查看 `高保真页面/供应链/` 下 S00–S08 的全部 9 张 PNG。没有用历史审计报告作为实现证据。

以下属于用户明确接受的变化，不计问题：供应链总入口改名“供应链任务驾驶舱”；采购员入口改名“个人工作台”；个人采购工作台取消原型顶部月份计划条及步骤条；沿用当前紫色 Horizon 视觉；保留 MateChat 原组件。功能合并进 Tab、弹窗或抽屉也不单独计缺失。原型示例姓名、数字、月份、图片不是必须写入正式台账的数据。

代码链接使用当前工作区绝对路径及核对时行号。由于工作区正在并行开发，后续行号可能移动。

## 逐页映射与覆盖

| 原型 | 当前正式入口与组件 | 代码可证的已实现能力 | 确认偏差与待验证 |
| --- | --- | --- | --- |
| S00 供应链管理总览 | `/proc-cockpit` → `ProcurementCockpitPage`，采购任务／样品协同／备货计划三个 Tab；[路由](E:/workCoding/inogi-ai-office/src/app/App.tsx:579) | 真实采购任务、业务线和人员筛选、状态统计、瀑布流／系统 Table、分页、附件、更多入口、子系统生产质量数据。[统计与筛选](E:/workCoding/inogi-ai-office/src/app/procurement/ProcurementCockpitPage.tsx:281) | 人员筛选没有同步统计卡（F02）。总览目前以采购任务数为主，未形成说明 L195 的所选批次需求、当前／按期齐套及质量风险同屏总览；不能把采购“在途任务数”当成整机齐套量。月份同步和各角色真实入口待现场验证。 |
| S01 采购工作台 | `/proc-my-workspace` → `ProcMyWorkspacePage`；列表 `ProcWorkspaceTaskList`、详情 `ProcWorkspaceTaskPanel`、到货 `ProcWorkspaceArrivals` | 按本人稳定账号归属、月份／跨月／无日期、产品、供应商、状态筛选；紧凑任务表、分页、缩略图、右详情、下一步操作及独立到货模块。MateChat 侧栏保留。 | 采购判断所需“当前缺料、未验收义务、按期覆盖、建议新增”没有在该工作台贯通（F03）。当前需求数量、已到货／未到货有明确名称，没有冒充缺料。订单下钻／返回、手机高度和真实图片可用性待现场验证。 |
| S02 研发采购协同 | `/rd-task/:taskId` 的转采购弹窗 `TransferToProcurementModal`；研发工作台关联采购只读入口；采购接收进入上述任务入口。[调用](E:/workCoding/inogi-ai-office/src/app/RDTaskDetailPage.tsx:2602) | 草稿、研发参与权限、填写物料／规格／数量／单位／日期／参考链接、附件与技术版本交付快照、同研发任务防重复采购、退回后补充。服务使用真实采购记录与附件来源。 | 正式提交仍允许缺需求日期／规格且无“不适用原因”约束（F07）。正式提交后技术资料变更的采购重新确认通知，需用真实业务串联验证；不能仅凭有冻结附件就认定通知闭环完成。 |
| S03 样品确认 | `/proc-cockpit?tab=samples` → `ProcurementSampleWorkspace`；内联 `ProcSampleTestDialog`；指定研发测试人员从研发工作台进入同任务测试 | 左侧选中样品、右侧可检索完整列表，详情与列表都有 `SampleProductImage`；真实附件预览与版本；到样／开测／结束时间；采购条件折叠；测试通过／重送样／重新询价、旧轮次历史和指定验证人权限。[分栏与内联详情](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcurementSampleWorkspace.tsx:114) | 缺研发探索／转产验证类型与对应必需资料、试装／小批结果、验证证据检查（F04）。布局结构已经覆盖原型核心，不能认定“右样品列表／产品图尚未实现”。正式图片来源、空图、窄屏操作和长附件列表需现场看。 |
| S04 整机齐套与物料库 | `/proc-inventory-readiness` → `InventoryReadinessPage`；另在 `/production-execution` 的“齐套与占用” → `ReadinessPanel` 有正式日期齐套；`/__preview/monthly-readiness` 为开发预览 | 库存中心按全 BOM 理论核算、明确区分在途、缺项提示、瓶颈明细与导出。生产执行的正式服务有需求日期、有效完工扣减、已确认未耗用线边、净库存、采购可用日期、版本快照。[日期齐套](E:/workCoding/inogi-ai-office/src/app/production/execution/ReadinessPanel.tsx:14) | 已下单供给缺跨计划分配约束（F01）。供应链库存中心本身不提供同一套日期预测；其 L210 明示在途未按日期筛选，不能称为按期齐套。另一个正式能力要求生产权限，不能用管理员可看证明供应链用户可用；见下文权限说明。 |
| S05 仓管工作台 | `/warehouse-flow` → `WarehouseFlowPage`；与 `/production-execution` 派工衔接，复用一个发料／签收服务 | 真实派工物料需求、分批发料、本人签收、待发／待签、权限、版本冲突、重复请求保护、T+ 库存核对与待核对占用。不是只有预览页，也没有另造生产库存系统。[服务校验](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-flow.service.ts:53) | 发料行没有实际物料批次／批号字段（F08）；现有 `batchId` 指生产批次，不等于实际领出的物料批号。真实 BOM 换算和领退料完整闭环需运行对应生产／仓管验收。 |
| S06 来料质量与原因分析 | 正式能力：驾驶舱子系统详情／备货计划中的 `SubsystemOperationsPanel`“采购与生产不良”，以及质量验证服务。高保真相近的完整分析页是开发专用 `/__preview/quality-exceptions` | 正式采购／生产两来源检验量、不良量、各自分母及单位、关联批次／物料／供应商、处理和授权复验；并非全是静态展示。[正式页](E:/workCoding/inogi-ai-office/src/app/procurement/components/SubsystemOperationsPanel.tsx:71) | 四来源质量原因分析仅有预览结构，未接正式台账（F06）。仓库／售后、原因待确认分布、同类别供应商比较和跨来源去重未在此正式分析链证明。 |
| S07 供应链人员任务 | `/proc-people-management` → `ProcPeopleManagementPage`、`people/PersonTasksDrawer`；同页独立 `OperationalTasksPanel`，另有 `/proc-operational-tasks` | 采购人员稳定 ID、历史人员归属、分月／跨月未完、采购和样品任务、经办转交；仓管／质量协同另有真实待办面板。 | 说明 L291 要求“按一个经办人聚合采购、样品、仓管及质量协同任务”。当前选人抽屉明确说明“仓管与质量人员任务尚未纳入此采购来源”（[L65](E:/workCoding/inogi-ai-office/src/app/procurement/people/PersonTasksDrawer.tsx:65)）；父页 [L295](E:/workCoding/inogi-ai-office/src/app/procurement/ProcPeopleManagementPage.tsx:295) 的独立操作任务面板没有传入所选 `personKey`，不构成同一人统一聚合。验收应为同一员工建立四类任务，切人后检查统一数量、跨月与当前步骤。历史改名、离职转交待真实账号验证。 |
| S08 采购到货安排 | 个人工作台的任务到货模块 `ProcWorkspaceArrivals`，以及日历 Tab `ProcurementDeliverySchedule`；采购订单行 `PurchaseOrderDeliveryDrawer/Panel` | 真实任务关联到货清单、日历／甘特、日期待确认范围、分页；原承诺与最新承诺独立保存、修改原因与证据、不可覆盖历史；精确订单行返回与筛选恢复；可只读显示预计检验可用日。 | 日期轴仍按 ERP 预计到货，最新承诺与检验可用日没有构成原型的计划到货轴与受影响批次视图（F05）。不应把已有完整交期记录说成未实现。 |

## 优先发现（按风险排序）

### F01 — S04：同一在途订单可被多个计划同时计入预计齐套（高）

- 要求：说明 L666“未分配给其他需求的已下单剩余数量”；L692“共用物料按计划分配；多个型号独立试算结果不可直接相加”。
- 代码证据：[production-readiness.service.ts L81](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:81) 只扣其他计划的仓库占用；[L93](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:93) 按相同物料编码取得采购行，并按数量、单位、确认日期判定；[L102](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:102) 将符合条件的采购剩余量全部求和加入本计划 `projected`。现有 [L128](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:128) 分配操作针对仓库净可用库存，没有订单行／订单供给的跨计划分配记录。
- 影响：两个需求计划共用同编码采购行时，都有机会显示被这份未来供给覆盖。界面 [ReadinessPanel L17](E:/workCoding/inogi-ai-office/src/app/production/execution/ReadinessPanel.tsx:17) 将其作为计划预计齐套，没有标为互斥模拟。现货占用保护不能替代未来采购供给的分配。
- 只读复现已确认：运行同组审查员提供的 [repro-s15-shared-purchase.mjs](E:/workCoding/inogi-ai-office/docs/ux-audit/2026-09-20-v11-review/repro-s15-shared-purchase.mjs)，调用真实服务及履约／日期函数，数据库替换为无写入内存夹具。两个计划各需 60、现货 0、唯一采购供给 60；两个计划均返回 `currentSets=0 / projectedSets=60 / incoming=60 / gap=0 / problems=[]`。两计划均已派工、领料申请待处理时结果仍相同。脚本断言真实订单查询只按物料编码，不是模拟数据忽略了计划过滤。尚未在真实库做写入验收；主审统一归口 F01，避免跨 S04／S15 重复计数。
- 验收建议：两个计划共用一笔按期采购 100 件，分配 A=60、B=40 后分别预测；再次给第三计划分配应拒绝超额。撤销／改期／部分合格收货后保留来源、版本和分配历史，不允许一份数量同时充当在途和现货。若只做独立模拟，必须明确标识且禁止当成已覆盖计划承诺。

### F02 — S00：人员筛选只改变任务列表，顶部统计卡仍为团队数（中）

- 要求：说明 L199“月份、产品和人员筛选同步影响卡片与列表”。
- 代码证据：[ProcurementCockpitPage L281](E:/workCoding/inogi-ai-office/src/app/procurement/ProcurementCockpitPage.tsx:281) 六项统计都从 `treeScopedTasks` 计算，依赖也只有该集合；[L344](E:/workCoding/inogi-ai-office/src/app/procurement/ProcurementCockpitPage.tsx:344) 才在列表集合里按 `buyerUserId` 筛选。头像计数本身与筛选后 KPI 是不同职责。
- 影响：选中无任务或少量任务的采购员后，页面仍显示全团队在制、在途、逾期等数值。数据没有丢失，但统计上下文不一致。
- 验收建议：为两人分别准备逾期、在途、待确认任务；依次选甲、乙、全部，六项统计和列表分别满足各自同一人员范围，点击状态卡不改变人员范围。另检查业务线、子系统、月份的组合筛选；统计卡是否应忽略自身状态筛选可以明确，但不能忽略人员。

### F03 — S01：工作台尚不能完成“缺多少、已覆盖多少、是否再采购”的判断（高）

- 要求：说明 L209“当前缺料、未验收订单量、建议新增采购、……预计可用日”；L213“当前缺料已被按期订单覆盖时，不能再次推荐采购同一数量”；计算见 L684–688。
- 代码证据：任务表 [ProcWorkspaceTaskList L15](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcWorkspaceTaskList.tsx:15) 显示需求数量和到货情况；[L69](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcWorkspaceTaskList.tsx:69) 使用采购任务数量／已到货事实。右详情 [ProcWorkspaceTaskPanel L93](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcWorkspaceTaskPanel.tsx:93) 仍是需求、已到、日期、付款；[L114](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcWorkspaceTaskPanel.tsx:114) 是已下单、已收、未收、预计到货，没有合格验收义务与本计划按期分配的净采购建议。
- 影响：收货 60 但合格 56、不良待补 4，与“全部未收为 0”不能互换；需求数量也不等于当前缺料。当前页面用词诚实，不应通过把“需求数量”改名“缺料”来仿照原型。正式库存／生产齐套在其他页面已有部分依据，但未关联为此处的采购决策。
- 验收建议：采用说明 L688：缺 60、按期未验收覆盖 60 → 建议新增 0；其中 20 延迟 → 按期缺口 20，并保留催交／调整选择。另验收收到 60、合格 56、不良 4，不得以未收 0 认定全部需求覆盖；缺来源时显示待核对，不补造 0。

### F04 — S03：验证类型与转产所需资料／试验检查缺失（高）

- 要求：说明 L237“类型（研发探索／转产验证）……SIP、SOP、治具依据、验证照片与记录”；L241“转产验证必须确认适用资料和试验结果”；L637 验证类型、结论、依据记录和验证人。
- 代码证据：[sample-test.ts L20](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/sample-test.ts:20) 正式测试记录模型只有轮次、人员、结果、说明、实际时间、采购条件和修订；[procurement.service.ts L2196](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement.service.ts:2196) 提交检查结果／1–500 字结论、指定测试人、轮次状态、实际到样开测结束时间和采购负责人，未检查上述类型及其适用资料／试装结果。[SampleTechnicalFiles L27](E:/workCoding/inogi-ai-office/src/app/procurement/components/SampleTechnicalFiles.tsx:27) 展示冻结交付附件，但通用附件列表不能代替每项“适用／不适用”及版本确认。
- 状态与布局已有正确部分：详情和列表均有产品图；[ProcurementSampleWorkspace L146](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcurementSampleWorkspace.tsx:146) 已折叠采购条件；[服务 L2213](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement.service.ts:2213) 失败重送样回 `pending_sample`、失败重新询价回 `inquiring`，通过回 `priced`，不是直接关闭生产合格。历史轮次存在，不能报告为“失败也能直接完成”。
- 影响：探索样品和转产验证使用同一结论门槛。即使人工在通用附件上传 SIP／SOP，也没有保证用户确认了本轮适用版本、治具和试验依据。
- 验收建议：探索型按配置允许部分资料不适用并填原因；转产型缺必需 SIP／SOP／治具或试验依据时禁止确认通过。同样品失败重送样保留前轮证据，指定新一轮验证人，并明确新的试装／小批结果；不能自动沿用旧轮通过记录。

### F05 — S08：供应商改期不改变日期视图的 ERP 到货轴（中）

- 要求：说明 L307“原承诺日、最新承诺日、预计检验可用日……需求日期、影响批次”；L309“更新后重算受影响齐套和计划”；L311 以预计检验可用日判按期。
- 代码证据：[purchase-delivery.service.ts L127](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-delivery.service.ts:127) 分组、[L136](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-delivery.service.ts:136) 选日／月份过滤及 L141 排序全部使用 ERP 镜像 `etaDate`；供应商最新承诺在 [L152](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-delivery.service.ts:152) 仅作为行补充字段返回。该日历响应没有检验可用日、需求日或受影响计划轴。个人任务到货模块 [ProcWorkspaceArrivals L219](E:/workCoding/inogi-ai-office/src/app/procurement/components/ProcWorkspaceArrivals.tsx:219) 会提示任务日期与最新订单 ETA 不同，但保留原任务到货日期排序。
- 已实现的边界：当前 UI 明确称“ERP 预计到货／供应商登记承诺”，没有虚称供应商承诺已改 ERP。原承诺留存、改期原因、证据与历史是真实能力。本问题是原型所需到货计划闭环未贯通，不是要求擅自覆盖 ERP。
- 验收建议：ERP ETA=10 日、原承诺=10 日、最新承诺=15 日、检验可用=16 日、需求=14 日；视图应能同时辨识这些日期，供应商改期后在计划视角显示风险和受影响批次。更新可用日后重新计算按期供给，ERP 来源值和原承诺保持不变。无日期必须进入待确认，不能被当作按期。

### F06 — S06：四来源质量原因分析仍是开发预览，正式页只有两来源台账（高）

- 要求：说明 L281“来源可切换来料、仓库、生产反馈、售后……按物料类别比较供应商”；L283 原因未知待确认，同批多来源关联且不重复计数；L726–737 要求明确分母、主因与同类比较。
- 代码证据：[App L82](E:/workCoding/inogi-ai-office/src/app/App.tsx:82) 和 [L496](E:/workCoding/inogi-ai-office/src/app/App.tsx:496) 将 `QualityExceptionsPreviewPage` 放在 `import.meta.env.DEV` 条件下；[预览页 L36](E:/workCoding/inogi-ai-office/src/app/procurement/quality/QualityExceptionsPreviewPage.tsx:36) 明示开发审阅、L39 使用 `createQualityPreviewState` 内存状态。正式 [SubsystemOperationsPanel L16](E:/workCoding/inogi-ai-office/src/app/procurement/components/SubsystemOperationsPanel.tsx:16) 来源只有采购／生产；正式服务 [procurement-operations.service.ts L181](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement-operations.service.ts:181) 也拒绝其他来源。正式汇总 [L123](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement-operations.service.ts:123) 按来源和单位计算，不是原型的原因分布和同类别供应商分析。
- 已有能力：实际检验数、不良率、批次关联、处置与授权复验存在；采购与生产分开统计，界面说明不重复相加。不能把“完整分析未接通”扩大为“质量数据全是演示”。
- 验收建议：在正式权限入口创建四来源记录，持久保存后刷新可读；同批问题跨来源引用同一异常，分母／不良件去重；未知原因单列。14000 检验、280 不良显示 2%；供应商比较仅同类别、同统计方式且附样本量。必须使用正式构建与 API 复验，打开开发预览不算通过。

### F07 — S02：需求日期和规格的完整性没有成为正式提交条件（中）

- 要求：说明 L635“数量、单位、需求日、图纸／规格、参考采购信息；不适用项说明原因”。
- 代码证据：[rdInsertion L374](E:/workCoding/inogi-ai-office/src/app/procurement/components/rdInsertion.tsx:374) 提交验证仅检查物料名、正数量、单位和至少一个附件；[L447](E:/workCoding/inogi-ai-office/src/app/procurement/components/rdInsertion.tsx:447) 空日期直接传 `undefined`。DTO [procurement.dto.ts L112](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/dto/procurement.dto.ts:112) 将日期标记可选；转采购服务 [L1037](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement.service.ts:1037) 强制至少一份交付附件，但 [L1083](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement.service.ts:1083) 直接解析可空需求日。规格为空也没有“不适用原因”要求。
- 影响：能生成缺交付要求的正式采购任务，后续无法判断按期与逾期。稿件允许不完整与正式提交允许不完整是两回事。
- 验收建议：草稿可缺；本人正式提交时逐项检查日期、规格／适用技术文件、参考采购信息或不适用原因；前端和 API 一致。保留合法的无正式料号临时需求，不能为补字段强行合并相似物料。

### F08 — S05：实际发料缺物料批号，生产批次不能代替（中）

- 要求：说明 L265“实际发料数与物料批次”。
- 代码证据：[warehouse-flow.service.ts L11](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-flow.service.ts:11) 发料行只有编码、名称、单位、需求／已发／已签数量；[L63](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-flow.service.ts:63) 实际事件保存编码、数量与仓库，没有实际物料批号。生产派工 [production-execution.service.ts L219](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:219) 的 `batchId` 来源是作业的生产批次，并未标识这一批生产实际用了哪些来料批号。
- 影响：同仓同料存在多个来料批次时，只能知道发了哪种物料、多少、从哪个仓发，无法按此记录追溯实际领用批次。这是该发料链路的字段缺口，不代表系统没有采购批号或生产批号。
- 验收建议：同物料从 A 批发 25、B 批发 15，总发 40；逐批签收、部分退料后能回看各批余量及原事件，质量追溯能定位实际耗用批号。现有重复请求、超发、代签和并发冲突保护继续有效。

## S04 入口与权限的补充判断

库存中心 [InventoryReadinessPage L210](E:/workCoding/inogi-ai-office/src/app/procurement/InventoryReadinessPage.tsx:210) 写明“在途未按到货日期筛选，不代表按期齐套”；[L412](E:/workCoding/inogi-ai-office/src/app/procurement/InventoryReadinessPage.tsx:412) 调用只提交型号和目标套数。因此其“库存＋在途”不能拿来验收 S04 日期预测。

日期预测并非整个系统没有：[ProductionReadinessService L29](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:29) 的正式读取要求 `page:production-execution` 加 `production:plan / production:view-all / production:inspect` 中之一；库存中心的 `page:proc-inventory-readiness` 不足以访问该服务。需现场用普通供应链主管／采购用户确认能否到达可读日期齐套，并决定复用入口与只读权限；不要为了复用而赋予生产写权限。`/__preview/monthly-readiness` 的演示算法与测试不代表正式供应链入口已打通。

## 本轮验证结果与仍需现场验收

已运行原有后端测试 106 项，全部通过：`procurement-sample-test.service.spec.ts`、`inventory-readiness.service.spec.ts`、`warehouse-flow.service.spec.ts`、`purchase-delivery.spec.ts`、`workspace-arrival-dates.spec.ts`。覆盖现有样品权限与轮次、库存不完整提示、发料幂等／库存保护、交期历史／版本、关联日期权限与精确身份。

已运行原有前端／导航测试 40 项，全部通过：`procurement-workspace-arrival-dates.test.mjs`、`workspace-arrival-navigation.test.mjs`、`purchase-delivery.test.mjs`、`purchase-delivery-panel.test.mjs`。覆盖读权限、异步竞态、分页范围、返回定位、日期格式、原 ETA 与新增日期并列显示、交期冲突保存等。

共 146 项通过；本分工未编写新测试、未对真实库执行写入。另实际运行同组提供的纯内存双计划复现脚本，退出码 0，已确认 F01 的重复预计覆盖。既有测试验证当前已实现规则，不能说明本报告列出的原型增量已实现。

优先现场路径：

1. 全权限／普通采购各选一个零任务人员，对比驾驶舱六项 KPI 与任务列表；再叠加业务线和子系统。
2. 个人工作台打开有分批收货、不良待补、延迟订单的真实任务，核对缺料、未验收义务与采购建议是否有其他明确入口。
3. 样品协同选择有版本文件和图片的测试任务，核实图片、文档顺序、右侧列表滚动及验证操作；验证类型与必需依据应以正式 API 为准。
4. 将订单供应商承诺与 ERP ETA 设置成不同日期，核对日历轴、检验可用日期和影响计划；必须保留原承诺。
5. 生产计划共用采购行的预测冲突已有只读服务复现，由主审 F01 统一归口。完整质量分析使用正式构建与正式记录，不以开发预览通过替代。

其他未证实项：原型 A01 跨年月份、A03/A04 240→270→270→300 标准数据在实际服务上的结果；S02 技术变更自动通知采购重新确认；S03 转产与生产试装权限；S05 BOM 用量、退料隔离与 ERP 实际核销全链路；S06 跨来源重复异常；S07 离职转交和同名员工场景；S08 真实角色可见范围。自动化已有覆盖的局部不等于整条现场链路已验收。
