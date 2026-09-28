# V1.1 供应链 S09–S18 原型与当前实现审核

日期：2026-09-20。范围：库存、收货、退料、盘点、出货、订单、月度齐套、质量、供应商、关键物料。方式：只读代码与原始资料审核，并对第1项执行真实 service + 纯内存 mock 的隔离复现；没有操作浏览器、连接数据库、执行接口写入或修改业务代码。除第1项附实际输出外，下列“确认”指源码可证实，不代表已经在运行环境复现。

## 原始依据与判定范围

资料目录：`C:/Users/Administrator/Documents/xwechat_files/zjw19920831_8887/msg/file/2026-09/INOGI_AI驾驶舱_V1.1全套开发资料_33页高保真/INOGI_AI驾驶舱_V1.1开发资料`。

已读取 `page_map.json` 的 S09–S18；`INOGI_AI驾驶舱_V1.1开发说明.md`（下称“说明”）313–451 行对应页面、639–715 行字段和算法、829–857 行验收。已逐张打开并目视核对 `高保真页面/供应链/` 下 S09、S10、S11、S12、S13、S14、S15、S16、S17、S18 的十张 PNG，而非只根据文件名判断。

图片中分别核对了：S09 批次状态及流水、S10 收货/检验/入库三阶段、S11 原领料关联与不良退回、S12 盘点复核前后、S13 放行/出货/SN、S14 剩余义务及交期历史、S15 整月/历史/下月情景、S16 原因与处置复验、S17 多对多供货关系、S18 固定 31 条线索与动态明细。

接受 Horizon 风格、现有命名、抽屉/标签承载多个原型视图，且不计个人采购工作台已明确移除的顶部月份目标和步骤条。说明第 17 行明确“不需要增加 33 个一级菜单”；因此没有用菜单数量判缺功能。演示数据是否齐全也不是本报告的缺陷依据。未引用任何旧 audit。

所有下述业务 URL 为当前 `App.tsx` 中的默认路由；正式路由通过 `routePath` 可受系统配置调整。预览 URL 的存在不抵消正式业务缺口，也不能据此断言整个功能未实现。

## 最重要的七项差距与建议验收

### 1. P1 / S15：按期采购供给尚未按计划分配，同一订单会进入多个计划预测

- 原文：说明 666 行“未分配给其他需求的已下单剩余数量”；692 行“共用物料按计划分配”。
- 证据：[production-readiness.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:81) 的 `allocations` 只扣其他计划仓库占用；93–104 行对本计划每个物料遍历同编码全部采购订单，按日期和状态求 `incoming`，没有订单行→计划的分配数量或他计划分配扣减。127–130 行的 `reserve` 也是仓库占用，不能分配订单供给。
- 影响：两个计划使用同一物料时，各自“预计可齐套”可以同时使用同一笔未到订单。S18 的“不能相加”提示避免了总量误读，但不提供原型要求的人工供给分配。
- 验收：隔离测试数据中建两个计划，各需物料 M 60，仓库 0，仅一笔按期订单 60；分给计划 A 后，A 预测 60、B 预测 0。交换分配、改变交期、部分收货后仍只计一次。入口 `/production-execution` → 齐套与占用。

实际隔离复现：`node docs/ux-audit/2026-09-20-v11-review/repro-s15-shared-purchase.mjs`，2026-09-20 运行退出码 0，脚本以断言固定下列当前错误行为。脚本使用真实 `ProductionReadinessService.read/calculate`、真实履约计算和日期指纹 helper，仅替换数据库为只读内存对象；未实例化 PrismaClient。

| 条件 | 计划 | 剩余需求 | 当前套数 | 日期内采购 | 预计套数 | 缺口 | 数据问题 | 引用订单 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 两个正式计划，未派工 | A | 60 | 0 | 60 | 60 | 0 | `[]` | only-po-line |
| 两个正式计划，未派工 | B | 60 | 0 | 60 | 60 | 0 | `[]` | only-po-line |
| 两计划均已派工，领料请求待发 | A | 60 | 0 | 60 | 60 | 0 | `[]` | only-po-line |
| 两计划均已派工，领料请求待发 | B | 60 | 0 | 60 | 60 | 0 | `[]` | only-po-line |

唯一订单实际总供给只有 60，两计划总需求 120。四次真实订单查询均为 `{"inventoryCode":{"in":["M"]}}`；mock 对完整 `where` 作相等断言，不会悄悄忽略潜在计划过滤。`production-execution.service.ts:216–225` 的派工只创建领料请求，未生成采购订单分配；加入对应请求后预测仍重复占用。真实发料服务会检查实际库存，但那不能保护派工前的按期预测承诺。此复现不证明数据库并发安全，也没有写正式业务数据。

### 2. S09：正式库存查询没有批次/互斥状态台账，物料详情流水被固定为空

- 原文：说明 319–325 行“可追溯到物料、批次、状态和收发调整流水”“合格现存、占用、可用、待检、不良、冻结”。
- 证据：[schema.prisma](E:/workCoding/inogi-ai-office/apps/api/prisma/schema.prisma:2014) 的 `ProcInventoryBalance` 只有编码、仓库、现存/可用/在途，唯一键为编码×仓库（2030 行），无库存批次或待检/不良/冻结分桶。[tplus-operations.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/tplus-operations.service.ts:144) 按物料聚合，218 行固定 `recentMovements: []`，239 行固定 `movements: []`。这不是“当前数据为空”，而是接口没有接出流水。[Inventory.tsx](E:/workCoding/inogi-ai-office/src/app/order-processing/pages/Inventory.tsx:774) 的明细按仓库展示。
- 已有补充：`/warehouse-flow` 的本地入库/退料/盘点保留事件，不应称为“完全没有仓库台账”；但该台账没有汇合到 S09 库存物料详情。
- 验收：同编码、同仓库的两批物料分别为合格和不良；库存详情应能区分批次和状态，并下钻对应收货、退料、盘点事件，不能只看到聚合数。

### 3. S10/S11/S12：本地确认与库存主账联动仍依赖后续 ERP 核对和同步

- 原文：说明 704 行“增加正确库存状态”、710 行“同步线边、仓库、齐套和批次档案”；A06/A08/A09（848–851 行）要求合格入库 +56、不良退回 +6、盘点复核后可用 178。
- 证据：[WarehouseRecordsPanel.tsx](E:/workCoding/inogi-ai-office/src/app/procurement/WarehouseRecordsPanel.tsx:17) 明确告知“ERP 核对完成并同步后才纳入主账可用库存”；33 行已核对后仍提示等待后续 ERP 同步。[warehouse-records.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-records.service.ts:74) 起确认收货及退料写 `runtimeState`，不是库存余额；[production-readiness.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:18) 确实从线边扣确认退料，70–83 行仓库来源仍是 ERP `availableQty`，仅附加待过账发料和负盘点扣减；没有把已确认合格收货/良品退料/正盘点加回仓库可用。负盘点只在生产齐套及领料控制中作保守扣减，S09 ERP 查询仍显示旧余额。
- 判定：这是有明确页面说明的当前业务边界，不能误称为“库存已双加”或直接要求回写 ERP。但与 V1.1 确认动作完成后业务口径同步的验收目标存在缺口，需明确本地台账何时形成可用库存、何时与 ERP 覆盖对消。
- 验收：完成 A06 后，在尚未同步和同步成功两个阶段同时检查订单、仓库、齐套；A08 确认线边只减一次且不良单独增加；A09 复核后库存页与齐套口径一致。同步失败应保持待核对状态和来源时间，重试不得双计。不要以修改正式 ERP 数据的方式现场验证。

### 4. S16：正式质量记录缺少独立主因确认和责任认定，预览流程更完整

- 原文：说明 419–423 行“主因状态”“主因及责任认定由授权人确认”“经手人不等于责任人”。
- 证据：[SubsystemOperationsPanel.tsx](E:/workCoding/inogi-ai-office/src/app/procurement/components/SubsystemOperationsPanel.tsx:97) 的表单与139行提交字段是现象、处置、状态、处理结果及业务关联，没有主因分类/确认状态/责任认定；[procurement-operations.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement-operations.service.ts:184) 持久化同样如此；[schema.prisma](E:/workCoding/inogi-ai-office/apps/api/prisma/schema.prisma:1988) 的正式质量模型没有这些字段。源仅允许采购/生产（service 181 行），未支持原型要求的仓库/售后来源分类。
- 已实现且保留：直接设为关闭会被拒绝（service 186 行）；[quality-verification.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/quality-verification.service.ts:69) 已有独立权限、处置前置条件、分批复验及关闭记录。不能笼统报“没有质量闭环”。但该流程未检查主因确认/责任认定。
- 对照：人工原因认定字段位于 `quality/QualityExceptionActionForm.tsx:226`，该入口受 [App.tsx](E:/workCoding/inogi-ai-office/src/app/App.tsx:82) 的 `import.meta.env.DEV` 限制，不能算已接正式数据。
- 验收：在正式不良记录中以“原因待确认”开始，由授权人确认主因与责任并记录依据，经办转交不改变责任认定；复验通过后能追溯对应确认版本。若业务允许未知原因关单，需明确豁免规则，不能把处理人自动当责任人。

### 5. S18：从来源页面进入时未沿用月份/产品，原单“详情”也未实际下钻

- 原文：说明 211、253、435 行“沿用当前月份、产品与权限范围”；449 行“点击物件打开采购交期、库存齐套、来料不良与原因、供应商详情”。
- 证据：[InventoryReadinessPage.tsx](E:/workCoding/inogi-ai-office/src/app/procurement/InventoryReadinessPage.tsx:666) 传 `productLine`；[KeyMaterialMonthlyPanel.tsx](E:/workCoding/inogi-ai-office/src/app/procurement/key-materials/KeyMaterialMonthlyPanel.tsx:8) 从今天初始化月/日，不读路由上下文，也没有产品参数；[key-materials.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/key-materials.service.ts:37) 月度接口按月份获取全部正式计划。驾驶舱入口 [ProcurementCockpitPage.tsx](E:/workCoding/inogi-ai-office/src/app/procurement/ProcurementCockpitPage.tsx:571) 只传裸路径。
- “查看原单依据与异常详情”在 `KeyMaterialMonthlyPanel.tsx:39–44` 只展开字符串、订单号和质量 ID，没有原单导航；目录唯一物料链接 `KeyMaterialsPage.tsx:51` 进入物料详情，该抽屉不等同订单/质量/供应商四种下钻。
- 验收：从某产品、历史月份进入，应保持上下文；切产品不改变固定 31 条目录但改变月度明细；选订单/异常应打开同记录并能返回原筛选。该问题可只读验证，无需演示数据写入。

### 6. S15：已有正式月度齐套和历史快照，尚无无正式目标的下月草稿情景

- 原文：说明 403–407 行“下月情景”“填写下月目标并预测”；670 行“含未下单计划另列为情景”；694 行“下月没有正式目标时只能显示草稿情景”。
- 证据：[ReadinessPanel.tsx](E:/workCoding/inogi-ai-office/src/app/production/execution/ReadinessPanel.tsx:11) 输入只有已选正式计划和日期；[production-readiness.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-readiness.service.ts:40) 要求正式计划存在，113–123 行写入动作只有占用、线边确认、快照。没有独立试算目标或未下单供给情景参数。[ProductionExecutionPage.tsx](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionExecutionPage.tsx:58) 无正式计划时要求先确认月度计划。
- 正向证据：service 33–37 行读取保存快照，123 行新建独立 ID，不会用最新交期改写旧快照；不能报“月度齐套/历史都未做”。
- 验收：下月没有正式目标，输入草稿 1000 台试算并显示草稿性质，不创建正式生产计划；有/无未下单方案分别显示；保存或比较当前重算结果不覆盖历史。

### 7. S13：真实发货已落库，已有 SN 关联与缺失提示仍未进入正式流程

- 原文：说明 377–381 行“已有 SN 名单及放行依据可关联”“未采集 SN 显示待补齐”。这不是要求第一版完成全量扫码。
- 证据：[LifecyclePanel.tsx](E:/workCoding/inogi-ai-office/src/app/production/execution/LifecyclePanel.tsx:28) 正式发货按批次、数量、实际日期、客户订单及凭证录入；29–32 行显示发货与档案，没有 SN 录入/关联或待补齐状态。[production-lifecycle.service.ts](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:18) 的发货模型与140行保存不含 SN。
- 已实现：有效放行余量限制、凭证去重、分批发货、原因冲销、独立月度净发货统计及批次档案。`/__preview/shipments` 有 SN 演示，不能代替正式功能。
- 验收：发货 20 台，无 SN 时允许按批次办理但显示待补齐 20；提供已有 12 个有效号码则保留关联、剩余 8 待补齐；冲销后历史保留，不改变整机检验合格累计。完整扫码系统不在本轮要求内。

## 逐页映射、已实现与未验证边界

| 页 | 真实路由 / 组件与 API | 当前已实现 | 确认偏差 / 待验证边界 |
| --- | --- | --- | --- |
| S09 库存记录 | `/inventory-management` → `order-processing/pages/Inventory.tsx`；`/proc-materials` → `MaterialWorkbenchPage` / `MaterialDetailDrawer`。真实库存服务 `TplusOperationsService.listInventory/getInventoryDetail`。 | 多仓库存聚合、搜索/分类/库存状态筛选、同步/重试/导出、物料编码下钻、来源及同步时间、关联采购单。 | 第2项：批次、互斥状态及库存流水未接。仓库操作另在 `/warehouse-flow`，不是不存在。尚未验证 ERP 实际字段、导入频率、角色权限、真实同步失败恢复。 |
| S10 收货检验入库 | `/purchase-orders/:id` → `PurchaseOrderDetail` / `PurchaseReceiptDrawer`；`/proc-operational-tasks?kind=warehouse` 或 `kind=quality` 分派入口；`/warehouse-flow` → `WarehouseRecordsPanel` 入库。API `procurement/purchase-order-lines/:lineId/receipts`、`procurement/warehouse-records`。 | 实收与 QC 分开，逐批收货、累计检验修订、合格/不良/待判分量；不良生成关联正式质量记录（`purchase-receipts.service.ts:277–285`）；版本/幂等、仓管确认入库、履约退换调整。 | 第3项：确认后的主账可用仍待 ERP；正式入库字段只有仓库，无独立库位/入库单号及附件上传，见 `WarehouseRecordsPanel.tsx:21`，原文335行要求入库单号。未执行 A06、多次检验与入库之后追加判定、同步覆盖冲突。 |
| S11 生产退料 | `/warehouse-flow` → `WarehouseRecordsPanel`；原领料人与生产执行共享入口。`WarehouseRecordsService.command` 的 `return` / `receive-return`。 | 关联本人签收领料，区分未耗用和已报工不良，分良品/不良/待判；实收不符被拒、累计可退范围检查；幂等、版本及操作历史；未耗用线边只扣确认退料。 | 第3项；另原文349行要求物料批次、照片、异常号：正式退料模型（`warehouse-records.service.ts:12–20`）无附件/异常关联，原料批次字段被填生产 `issue.batchId`（94行），不是独立来料批次。未运行 A08、不良已报工退回防重复扣减、差异退回后重提。 |
| S12 盘点调整 | `/warehouse-flow` → `WarehouseRecordsPanel`；`warehouse-records` 的 `count` / `approve-count` / `reconcile`。 | 账面和实盘、原因、填报人与复核人分离、复核前不影响余额、来源版本冲突阻止、重复盘点阻止、ERP 凭证核对、负盘点影响领料与生产齐套。 | 第3项；仅“合格数量”盘点（`WarehouseRecordsPanel.tsx:22`），不能盘点指定待检/不良/冻结状态或库位批次；原文363行有“物料/批次/状态”。未运行 A09、正盘点、多人冲突、后续 ERP 覆盖。 |
| S13 实际出货 | `/production-execution` → `ProductionExecutionPage` 的“放行与发货”及“批次档案” → `LifecyclePanel`；API `procurement/production-execution/:id/lifecycle`。 | 实际日期、客户订单、凭证、批次、部分发货、有效放行约束、发货/完成分列、冲销与历史、导出档案。 | 第7项。说明80行说仓库业务归供应链；当前承载生产执行标签是信息架构差异，因共享模块可接受，不单列功能缺失。未验证 A18 净发货、跨月统计及重开质量后旧放行失效。 |
| S14 采购订单详情 | `/purchase-orders/:id` → `PurchaseOrderDetail`，`PurchaseReceiptDrawer`、`PurchaseFulfillmentDrawer`、`PurchaseOrderDeliveryDrawer/Panel`。相关 `PurchaseReceiptsService`、`PurchaseFulfillmentService`、`PurchaseDeliveryService`。 | 订单行定位、订购/净履约/取消/收货/检验量、退货保留补交义务、履约审批、原/最新承诺及 ERP 观察历史、预计检验可用日期、关联任务、受影响备货计划。 | 本轮未发现新的核心数量闭环缺口，跨计划订单分配归第1项。原文391行含合同附件；当前“合同与结算”仅条款及来源（`PurchaseOrderDetail.tsx:548–559`），附件可能在关联采购任务中，尚未验证是否能按订单行追溯到同合同，不能据此认定系统没有附件。未执行 A05、退货/冲销/取消组合、来源变更重新确认及不同权限经办转交。 |
| S15 月度/历史齐套 | `/production-execution` → “齐套与占用” / `ReadinessPanel`；`ProductionReadinessService` 与 `/production-execution/:id/readiness`。另 `/proc-inventory-readiness` 是全 BOM 理论套数中心，页面明确在途未按日期筛选，不应混同正式按期月度计算。 | 正式月目标、有效完成后剩余需求、完整 BOM、当日线边确认、仓库他计划占用、按检验可用日期筛订单、缺来源显示待核、保存及查看独立历史快照。 | 第1、6项；尚未验证 A03/A04/A24 的真实服务结果、历史不变与当前重算比较、跨月计划范围。 |
| S16 质量异常 | `/proc-cockpit` → 具体子系统的 `SubsystemOperationsPanel` 质量页签 / `QualityVerificationDialog`；生产来源也可在 `/production-execution` 处理同异常。`ProcurementOperationsService`、`QualityVerificationService`。 | 正式采购/生产来源、物料/供应商/任务/批次关联、检验和不良量、处置、处理结果、独立复验、部分通过累计、关闭/重开历史、原来源数量保护。 | 第4项；正式记录缺图像/附件与结构化主因认定。生产协同可转处理人，不能推断所有来料异常也具备同样转交链。未执行 A17、复验重放/剩余数、跨来源同批问题去重及同异常关联。 |
| S17 供应商物料 | `/proc-quote-book?view=suppliers` → `QuoteBookPage` / `QuoteBookSupplierView` / `QuoteImportModal`；物料维护 `/proc-materials`。`QuoteBookService` 与 T+ 供应商镜像。 | 同料多厂家报价、按供应商查物料、正式供应商 ID 与未关联快照区分、MOQ/阶梯价/交期/有效期、图片报价 OCR+AI 预览后人工确认导入，不能报“没有照片识别”。 | 原文433行要求“供货关系状态”；现页仅供应商档案启停/关联状态及报价状态，明确“供货资质需另行确认”（`QuoteBookPage.tsx:320`）；`quoteBookDirectoryModel.ts:24–54,81–82` 从报价生成目录，不等同独立物料×供应商合格供货关系。白板无报价清单是否能正确形成待核草稿、报价附件与质量记录直达尚未验证；不能把 OCR 未配置算实现缺失。 |
| S18 关键物料 | `/proc-key-materials` → `KeyMaterialsPage` / `KeyMaterialMonthlyPanel`；`KeyMaterialsService` / `procurement/key-materials`。 | 固定31条独立于需求、K29候选状态、K30/K31多料号映射、正式ID去重、人工权限确认与历史、歧义词保留、库存未知显示待补齐、正式计划需求/订单/未闭环质量摘要。 | 第5项。原文449行四类筛选，当前目录仅全部/资料待核（`KeyMaterialsPage.tsx:47`），月度没有本月需采购/缺料筛选；月度摘要字段也少于原型的线边、待检、不良、完整供应关系明细。未运行 A20–A24；真实ERP完整展开只能用企业清单验证，不凭缺数据判未实现。 |

## 覆盖边界与建议的验证顺序

1. 先做只读：S18 从不同产品/月份入口进入是否保持范围，S09 库存详情是否能见真实流水，S13 正式页 SN 缺失是否提示；这些可在现有页面观察，不需新增业务记录。
2. 在隔离测试数据中验证：S15 两计划共享一订单的分配；A06/A08/A09 在 ERP 同步前后各页面一致性；S16 主因确认、分批复验、关闭及重开。
3. 最后验证完整性：S15 草稿情景与历史快照差异；S17 合格供货关系与报价状态区分；S18 31条线索与真实塑料/硅胶全部正式料号的映射及去重。

本报告没有证明实际 ERP 环境的库存质量、账户权限配置、生产数据完整性、移动端交互或请求幂等在运行时全部通过；也没有将这些未验证项冒充已确认故障。DEV 预览页仅用于判定哪些设计已存在，正式完成度依据正式组件、API 与持久化链。
