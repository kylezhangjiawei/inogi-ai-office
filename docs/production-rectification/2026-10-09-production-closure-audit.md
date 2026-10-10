# 生产与质量模块：遗漏与闭环检查报告

检查日期：2026-10-09
检查对象：当前工作区（包含已有未提交改动），不是仅检查原型或历史方案。
本轮方式：只读代码调用链核对、现有测试、内存业务场景复现、隔离预览中的页面交互。仅新增本报告，未修复代码，未写入真实数据库或 ERP。

## 1. 检查结论

**当前已有实际业务能力，但尚不能认定“从到料到生产、质量、放行、发货、追溯”完整闭环。**

派工、领料签收、报工、检验、不良协同、复验、QA 放行及发货均有真实接口和校验，不是只有静态页面。主要问题集中在跨环节数量衔接、必要工序约束、完工口径及异常后的恢复路径。

本次确认 **13 项问题：8 项 P1、5 项 P2**。P1 表示影响流程完成、业务数量或放行条件，应优先补齐；P2 表示影响特定办理场景、历史准确性或页面操作。数量不包含后文尚未实施的需求和待明确的业务取舍。

验收依据以用户已确认的会议结论为准：

- 性能测试及最终闸门通过才算整机完工；QA 放行单独记录。
- 月度实际完工按闸门通过日期统计，包含往月生产单；本月计划完成率按计划归属另算。
- 来料先由仓库通知到货，再由计划员确认用途、需求日期及检验优先级，质检负责质量结论。
- 按工序分产线派工、报工；现场登记简化；异常需要转交、协同和跟踪。
- 页面继续对应提供的原型；原型没有数据依据的功能可取舍，不能用静态展示代替业务完成。

## 2. 已确认的 13 项问题

### A01 · P1：后台仍把普通终检当作整机完工及 QA 可放行依据

**场景与影响：**只有普通终检通过，没有性能测试、最终闸门记录，后台仍可累计整机完工并计算 QA 可放行数量。驾驶舱已诚实显示完工指标“—”，但后台规则还没有同步到已确认口径。

**代码依据：**[production-execution.model.ts:72](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:72) 把所有非过程检记录纳入完工；[production-lifecycle.service.ts:101](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:101) 复用其计算放行数量。

**建议与验收：**建立性能、最终闸门的正式结果及通过时间。只有普通终检时不得计入整机完工；闸门通过后按日期计入实际完工，QA 仍保持独立状态。历史无明确类型的记录不能自动冒充闸门通过。

**证据等级：**确认，代码调用链。电子闸门页面实际存在，但目前主要处理规则、协议和配置发布，没有与生产单关联的测试结果链，不能据页面存在判定已实现。

### A02 · P1：未开工工序不阻止最终作业报工和 QA 放行

**复现：**同生产单的组件任务仍为草稿，整机任务报工 200 台、终检合格 200 台后，QA 放行成功。

**原因：**任务没有必要工序及前置关系。放行仅检查“已报工是否已终检”，未开工任务的两者都是 0，未被识别为未完成生产环节。

**代码依据：**[production-execution.model.ts:13](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:13)、[production-lifecycle.service.ts:106](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:106)、[放行入口:199](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:199)。

**建议与验收：**最小补齐生产单的必要工序、前置关系及完成数量。明确允许并行或可选的工序，其余未完成时阻止下游完成/放行。无需先建设复杂自动排产系统。

**证据等级：**确认，真实服务代码的内存场景复现。

### A03 · P1：整机报废后没有可执行的补产或短结路径

**复现：**目标/报工 200 台，终检 194 合格、6 报废，异常独立验证关闭后，仍剩余 6 台并跨月未完。新增 6 台整机任务被派工上限拒绝；原任务减至 194 被已报工下限拒绝；原任务追加报工也受累计数量及签收上限限制。

**代码依据：**[派工上限:119](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:119)、[调整下限:152](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:152)、[累计报工上限:188](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:188)、[跨月判定:65](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:65)。

**建议与验收：**增加与原生产单关联、经批准的补产数量；另设取消剩余量/短结并保留原因。报废不增加合格数，补产不重复增加净交付目标。上述 6 台应能补产完成，或批准短结后退出未完队列。

**证据等级：**确认，内存复现。当前限制本身保护了历史数量，修复不应直接解除所有上限。

### A04 · P1：同一不良跨过程检、终检可重复建异常并重复统计

**复现：**同一报工 50 台、同一组 6 台不良，先登记过程检 50/44，再登记终检 50/44，生成两个质量号，各 6 件。汇总按质量记录相加，得到 12 件。

**限定：**不是所有两次检验都应该合并。问题在于确为同一实物不良时，没有沿用前次检验异常的路径；当前防重主要覆盖现场提报与首次检验、同请求重试等场景。

**代码依据：**[检验分组:177](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:177)、[异常关联限制:339](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:339)、[质量件数汇总:252](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/procurement-operations.service.ts:252)。

**建议与验收：**允许后续检验关联原异常，区分检验发生次数与不良实物件数。同一组 6 件多次检验保留全部履历，但不良件数只计 6；新增不良仍可另计。

**证据等级：**确认，内存复现。

### A05 · P1：来料返工/让步复验通过后，采购合格入库数量不恢复

**复现：**收货 10 件，初检 6 良品、1 不良、其余待检/待判。原不良 1 件返工并复验通过，异常已关闭，采购收货计算仍为 6 合格、1 不良。ERP 后续可创建入库量也继续依据原合格量。

**原因：**质量复验仅更新异常及验证记录；采购履约没有消费“复验转良”的数量。原检验不良量进入处置后又禁止覆盖，不能靠改原记录补救。

**代码依据：**[quality-verification.service.ts:130](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/quality-verification.service.ts:130)、[purchase-fulfillment.model.ts:44](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-fulfillment.model.ts:44)、[erp-purchase-receipt.service.ts:120](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/erp-purchase-receipt.service.ts:120)。

**建议与验收：**保留初检 6/1，增加可追溯的验证释放量；采购履约、仓储和 ERP 差额入库共用净合格数量。此例净合格应为 7，原 6 已入库时只允许补入 1；退货/报废不转合格。

**证据等级：**确认，内存复现；没有向真实 ERP 提交单据。

### A06 · P1：原异常开始处置后，同批剩余待检物料新增不良被卡住

**复现：**原 1 件不良进入处理中，再将剩余待判中的 1 件判为不良，累计不良从 1 变 2，被拒绝：“异常已进入处置，不可覆盖原初检范围”。

**原因：**同收货批次绑定一个异常，原异常进入处置后要求不良数量不变；没有为剩余物料新增检验分组的通路。当前测试还明确断言这个拒绝规则，说明测试通过不代表覆盖了持续检验需求。

**代码依据：**[purchase-receipts.service.ts:263](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-receipts.service.ts:263)、[处置保护:272](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-receipts.service.ts:272)、[既有测试:273](E:/workCoding/inogi-ai-office/apps/api/test/purchase-receipts.spec.ts:273)。

**建议与验收：**冻结已处置范围，但允许剩余数量追加检验及新异常分组；总检验量不超实收量，已处置原记录不回写。不应要求伪造新送货单绕过。

**证据等级：**确认，内存复现。

### A07 · P1：QC 后发现的不良可能无法退料入库

**复现：**现场报工 50 件且自报良品 50；QC 后判 47 良品、3 不良。退回对应 3 件物料，即使关联正确异常号，仓库接收仍失败：“退回数量超过未耗用或不良可退范围”。

**原因：**可退上限只用“报工数量－报工良品”计算，未消费 QC 后续判定的原异常数量。

**代码依据：**[warehouse-records.service.ts:103](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-records.service.ts:103)、[接收限量:206](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/warehouse-records.service.ts:206)。

**建议与验收：**按原质量异常、实领物料及已退/已处置数量确定可退范围，扣除已复验转良数量。同例应能接收合法的 3 件，重复退料仍拒绝。

**证据等级：**确认，内存复现。

### A08 · P1：有未解决 ECN 执行问题，原 QA 放行仍可以发货

**复现：**先终检通过并 QA 放行，再发布适用于该批次的生效 ECN、登记未解决执行反馈，阅读确认人数为 0。新派工被阻止，但原放行下登记发货成功。

**原因：**ECN 校验只在派工依据中使用，QA/发货及放行依据失效计算没有消费适用 ECN 状态。

**代码依据：**[production-lifecycle.service.ts:33](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:33)、[放行依据:95](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:95)、[放行与发货入口:195](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:195)。

**建议与验收：**定义会阻断生产/放行的 ECN 状态，纳入放行依据和发货复核。存在相关未解决执行问题时拒绝发货；完成必要确认及执行验证后重新核对放行。阅读确认不能直接视为执行验证。

**证据等级：**确认，内存复现。无需把所有无关历史 ECN 都设为阻断。

### A09 · P2：适用 ECN 下改派负责人存在循环条件

**复现：**新负责人没有该批次现有任务，不能先确认阅读 ECN；保存改派又要求新负责人已经确认，因此正常换人无法完成。

**代码依据：**[本人确认条件:157](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:157)、[改派前校验:310](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:310)。

**建议与验收：**定向发起待接收改派，新负责人可确认与本人交接有关的 ECN，满足条件后正式接管。保留本人确认，不开放代签绕过。

**证据等级：**确认，内存复现。

### A10 · P2：批次档案漏现场异常，操作历史范围不完整

**表现：**现场异常尚未关联检验时，后端已经返回它，但批次档案按检验记录筛选质量号，导致“存在未闭环异常”却在“质量与复验”中看不到。批次历史还没有包含所有生产操作及版本范围登记/更正事件。

**代码依据：**[后端异常集合:61](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-lifecycle.service.ts:61)、[前端质量过滤:194](E:/workCoding/inogi-ai-office/src/app/production/execution/LifecyclePanel.tsx:194)、[历史主体:196](E:/workCoding/inogi-ai-office/src/app/production/execution/LifecyclePanel.tsx:196)、[展示入口:264](E:/workCoding/inogi-ai-office/src/app/production/execution/LifecyclePanel.tsx:264)。

**建议与验收：**复用现场提报与检验的异常 ID 合集，汇总已存在的历史来源；如暂不合并，应准确标注历史的范围。现场登记后，无需先补检验就能从批次档案找到原异常。

**证据等级：**确认，静态调用链；本轮未逐个点击档案标签复测。

### A11 · P2：不需要领料的工序无法派工

**复现：**创建“性能调试”任务且不选择物料，服务拒绝。当前所有派工强制至少一个 BOM 物料，并产生领料需求，无法自然表达调试、老化等不重复领料的工序。

**代码依据：**[必选物料:132](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:132)、[自动领料需求:360](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:360)。

**建议与验收：**工序明确选择“需要领料/不领料”。不领料工序仍可派工、报工和验收，不生成空领料单；有用料工序继续遵守 BOM 和签收限制。

**证据等级：**确认，内存复现。

### A12 · P2：调线会改变历史报工的产线归属

**复现：**一线已报工 200 后，将任务调整到二线，总览将这 200 全部计入二线。报工没有当时产线快照，统计使用任务当前产线。

**代码依据：**[报工模型:8](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:8)、[任务调整:159](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.model.ts:159)、[总览汇总:46](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/production-execution.service.ts:46)。

**建议与验收：**报工固定当时产线/工序，调整只影响后续报工；前 200 留在一线，新报工计入二线。存量历史若无法可靠还原，应明确标注，不能编造归属。

**证据等级：**确认，内存复现。

### A13 · P2：切换产品型号后残留生产单筛选，造成任务和检验假空白

**浏览器复现：**在现场队列选择 Q7 的生产单 B-1008-01，再把全局型号切为 Q5，地址仍带旧 batch。队列为空，生产单控件显示空白；进入 P03 后继续受旧 batch 过滤，但 P03 没有对应生产单选择控件。移除旧 batch 参数，Q5 的待检任务重新出现。

**代码依据：**[未清理 batch 的范围字段:50](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionWorkspace.tsx:50)、[全局切换:105](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionWorkspace.tsx:105)、[队列筛选:20](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionWorkQueue.tsx:20)、[P03 隐藏沿用:24](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionInspectionOverview.tsx:24)。

**建议与验收：**切换全局型号/计划/月时清理不再适用的下级筛选；目标页面不得静默沿用不可见筛选。依次切换 Q7→Q5、月份及页面，实际存在的任务应可见；有效范围内的筛选可保留。

**证据等级：**确认，本地 Chrome 隔离预览的真实前端交互，使用虚拟数据，只读请求。

## 3. 对照原型：当前覆盖与遗漏

这里的“部分”表示有真实功能但仍有缺口，不表示应重写整个模块。P09 未在本次提供的原型中，不补造页面。

| 原型 | 当前项目对应 | 状态与需补齐内容 |
|---|---|---|
| P00 生产管理总览 | ProductionDashboardPage | 已按原型组织主要区域；完工、计划完成率及在岗数据尚缺真实来源。完工目前显示“—”，不能按普通终检补数。调线统计受 A12 影响。 |
| P01 生产计划与派工 | ProductionPlanningPage | 月计划、生产单、多产线派工、型号筛选、用料与缺口已有；缺必要工序约束、无领料工序及报废补产，见 A02/A03/A11。 |
| P02 现场任务与不良登记 | 现场队列 → ProductionTaskDetail / ProductionFieldIssueDialog | 自动带出生产单，报工、现象选项、图片/视频已有；未有独立初步原因选项。登记依赖已有报工且报工不良数大于 0，不能覆盖尚未报工时即时发现的问题。 |
| P03 生产检验与复验 | ProductionInspectionOverview | 正式过程检、终检与原异常复验可办理；来料、性能、最终闸门尚未进入统一检验任务，另有 A01/A04/A13。 |
| P04 生产问题转研发 | ProductionQualityPage（协同视图） | 已扩为生产问题协同，支持跨部门转交、真实经办、期限和回复；缺独立接单/拒绝以及指定验证人待办。 |
| P05 转产确认与批次档案 | LifecyclePanel（转产/档案） | 样品验证、受控资料、独立验证、发布及固定版本已有；档案受 A10 影响，仍为当前计划内查询。 |
| P06 生产全部任务 | ProductionAllTasks | 当前只聚合派工、待终检和质量异常；没有聚合 IQC、ECN 确认、转产确认等全部生产待办。不能按原型理解为真正“全部”。 |
| P07 批次计划与工序安排 | ProductionSchedule（原型布局） | 日期、任务、产线安排和调整已有；工序目前主要表现为任务名称，尚无必要工序、前置关系及无领料分支。 |
| P08 生产不良处理 | ProductionQualityPage（不良视图） | 原异常、处置、协同、独立复验及重开已有；缺现场负责人初判、接单/退回环节，且数量回流受 A04/A07 影响。 |
| P10 ECN 变更查看与确认 | LifecyclePanel（ECN） | 适用批次、发布时间、资料及本人阅读确认已有；缺完整执行验证/关闭，存在 A08/A09。 |
| S06 来料质量与原因分析 | QualityRecordsPanel | 四来源分析、原因/责任、附件和历史已有；主入口仍在供应链相关页面，未完成生产检验侧统一入口及计划前置流转。 |
| S10 收货检验与入库 | 现有采购收货、检验及仓储入口 | 采购订单关联、分批收货、检验分量及合格量 ERP 入库已有；缺计划用途与优先级审批，A05/A06 阻碍后续闭环。 |
| S11 生产退料接收 | 现有仓储领退料流程 | 实领来源、退料、仓库接收、差异退回和重提已有；QC 后判不良受 A07 影响。 |
| S16 质量异常处置详情 | QualityRecordsPanel 及原异常处置/验证入口 | 原因、处置、复验已有，不能视作静态空页；来料处置、采购反馈与库存恢复仍需统一，见 A05/A06。 |

**布局边界：**生产 P 系列已有上一轮原型对齐；S06/S10/S11/S16 仍沿用现有供应链业务页面，未完成相同程度的原型布局重构。本轮重点检查逻辑与遗漏，仅对 A13 做了新浏览器复现，没有重新完成全部页面、多尺寸的视觉验收。

## 4. 已约定但尚未完整落地的需求

### 4.1 来料检验进入生产管理，补计划前置环节

目标链应为：仓库确认到货 → 计划员确认用途/关联生产单、需求日期、检验优先级 → 质检检验 → 合格入库/不良隔离 → 结果反馈采购与生产计划。

当前有收货、质检和用料缺口的数据基础，但缺“计划确认”状态、字段及对应待办，也不能证明检验结果形成了采购/计划的正式反馈任务。建议保留仓库入口及同一收货记录，在生产 P03 增加来料检验视图，不复制第二套收货台账。若与多个生产单有关，应允许分配用途或标记公共备货，不能强制伪造单一用途。

### 4.2 不良先初判，再接单、处理、复验

推荐最小链：现场提报 → 现场负责人初判 → 接收部门确认/退回 → 处理回复 → 独立复验 → 数量处置完成后关闭。

当前有转交及接收人回复，但没有独立初判、接受/退回节点；验证安排主要是文字，尚未形成指定验证人任务。P02 还应补可选的“来料/软件/装配/其他”初步原因，以及报工前发现问题的登记路径。保留照片/视频及自动带出生产单，不恢复繁重手填。

### 4.3 完工、QA、包装、发货保持独立

性能/闸门数据缺口见 A01。包装尚未发现独立正式记录：批次包装数量、日期、执行人及必要检查不能追溯。若希望交付链完整，建议先做最小批次包装登记；可暂缓箱号明细和自动装箱，不应把包装改作单台完工依据。

作业目前有派工状态及计算进度，未见执行完成自动联动主任务关闭的完整依据。研发到生产的同步是只读镜像，不能当作生产结案已回传。应明确“净目标完成”或“批准短结”后，哪些任务结束、哪些质量/发货记录仍继续办理。

### 4.4 档案从当前计划扩大为可查询的生产单索引

目前可查当前计划的批次、版本、领退料、检验、QA 和发货；已有有效 SN 范围及发货占用保护。尚不是跨计划、按生产单/SN/来料批次查询的统一入口，也没有性能、闸门、包装结果全链。

建议先补跨计划生产单索引，沿现有 ID 跳转原记录；待前三类结果接入后扩展追溯。避免另建一套复制的业务数据。SOP/SIP 版本与资料管理已有基础，但日期是否在全部现场查看入口清晰展示，本轮未逐入口重新验收，不列为已全面通过。

### 4.5 “全部任务”必须与实际覆盖相符

当前聚合范围见 [ProductionAllTasks.tsx:14](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionAllTasks.tsx:14)。建议把已存在的 ECN、转产、复验待办以链接方式接入；来料与计划确认待办随对应流程补齐。若暂不扩展，名称或范围说明应明确为“现场派工、终检与异常”，不能制造全部任务已经覆盖的印象。

## 5. 可取舍项与需保持的边界

建议优先保住业务结果准确和异常恢复路径，可作以下取舍：

1. **自动排产可暂缓。** 先做人工确认的必要工序、顺序/并行关系及进度校验，满足按工序分线派工。
2. **设备自动采集可后接。** 性能/闸门先允许有权限人员登记可核对的结果和证据，建立正式结果链；不能用普通终检冒充。
3. **复杂包装可暂缓。** 先登记批次包装及数量，箱号层级、自动装箱后续再做。
4. **AI 原因建议、自动供应商评级、没有考勤来源的在岗指标可隐藏或延期。** 先使用真实质量统计；不得填演示数值。
5. **多套重复工作台不再增加。** 沿现有 P/S 页面布局补真实入口与状态；生产检验和仓库共同访问同一来料记录。

有两项适合在后续实施时明确规则，不作为本次额外已确认缺陷：

- 初步原因按会议要求可选。目前没有原因分析也能完成处置验证并关闭；但关闭页面会把“原因判定”显示为已完成。可以允许低风险异常免根因分析，但界面必须展示真实原因状态；高风险异常是否必须确认根因再关单，应按质量管理要求确定，不能自行把所有原因改成必填。
- 晚补 SN 当前取补录时有效版本，现有测试明确如此。是否允许在补录时指定历史实际版本，需要业务规则；不能直接宣称既有版本快照已被覆盖。

## 6. 已具备且应保留的保护

- 派工数量、领料人签收、累计报工上限、权限、请求幂等及版本冲突控制已有实现；不应为解决补产问题整体拆除限量。
- 过程检不会直接计整机完工；未检报工和未闭环异常会阻止 QA/发货。缺口在最终闸门、未开工必要工序和 ECN。
- 现场首次异常与后续首次检验可以沿用质量号；独立复验、剩余量复验、重开及放行失效已有保护。A04 是跨检验阶段的补充缺口。
- 转产有样品轮次、受控资料、编制/验证分离和发布复查；派工固定资料版本，新发布不会自动覆盖历史依据。
- 发货有限量、日期、唯一凭证、冲销留痕及 SN 重复占用保护；版本范围更正保留旧记录，已发 SN 不能随意移走。

## 7. 验证结果与限制

| 验证范围 | 本轮结果 | 能证明什么 |
|---|---|---|
| 生产前端导航、检验、排程及质量相关 5 组测试 | 43/43 通过 | 现有已编码的页面/导航约束成立，不覆盖全部跨页面组合；A13 仍可复现。 |
| 来料、质量、采购履约、仓储及 ERP 入库计算相关 6 组测试 | 111/111 通过 | 已有服务规则通过；不等于真实 ERP 已联调，A05/A06/A07 另行复现。 |
| 生产执行、驾驶舱及 V1.1 相关 3 组测试 | 43/43 通过 | 已有数量、权限及统计保护通过，新增跨环节场景仍暴露 A02/A03/A04/A11/A12。 |
| 生命周期、档案和 SN 相关 3 组测试 | 21/21 通过 | 已有转产、放行、发货保护通过，ECN 跨环节问题另行复现。 |
| 服务端补充场景 | 使用既有夹具在内存执行真实服务代码 | 复现上述标明“内存复现”的问题，没有新增正式测试文件。 |
| 隔离预览页面 | 本地 Chrome，虚拟数据 | 确认 A13 的真实界面症状；不操作真实业务。 |

后端测试组存在重叠，**不把上述数字相加当作独立用例总数**。本轮未重新执行全仓构建或全部测试，未对真实 PostgreSQL 并发、实际账号配置、ERP 写入、物理检验设备和所有屏幕尺寸进行端到端验收。测试通过与业务完整闭环是两个结论。

本次前端测试文件：

- `scripts/production-prototype-navigation.test.mjs`
- `scripts/production-prototype-inspection.test.mjs`
- `scripts/production-workspace-navigation.test.mjs`
- `scripts/production-schedule.test.mjs`
- `src/app/production/execution/ProductionQualityPage.test.mjs`

主要跨模块修改风险为中等：质量、采购履约、仓储和放行分别计算数量，生产与生命周期状态部分存于 RuntimeState JSON，前端还有再次聚合。应沿现有服务共享明确的净数量与状态规则，补跨模块回归，避免引入另一套平行台账。

## 8. 建议整改顺序与验收门槛

**第一批：数量与放行正确性。** A01、A04、A05、A06、A07、A08。验收必须覆盖普通终检不得冒充闸门、同一不良不重复计件、复验转良只补入差额、后续待检可新增不良、QC 不良可合法退料、阻断性 ECN 不得沿用旧放行发货。

**第二批：生产过程及异常恢复。** A02、A03、A09、A11，并补来料计划前置、现场负责人初判/接单、最小包装记录和生产单结案规则。验收应包含未完必要工序、报废补产、短结、无领料工序、人员交接以及来料的采购/计划反馈。

**第三批：查询、追溯和原型遗漏。** A10、A12、A13，补跨计划档案索引、真实全部任务范围及 S 系列页面对齐。A13 改动较小，可先作为独立修复，但不能代替前两批验收。

**最终验收至少跑通两条数据一致的链：**一条正常来料→计划确认→检验入库→工序派工/报工→性能/闸门→QA→包装→发货→追溯；一条包含新增来料不良、返工复验、QC 退料、报废补产及 ECN 变更的异常链。每一步的数量、负责人、原单关联、历史记录和后续待办都应能对上。

实际采用技能：health-audit（只读证据审计）、ponytail（沿实际调用链定位及最小补齐建议）、i-have-adhd 0.4.1（中文分组交付）。

## 9. 四张新增批注图的对照补充（2026-10-09）

本节补充用户随后提供的四张红色批注原型，并纳入其明确答复：图 3 的“发货单号”和“关联异常”均删除页面字段。本轮仍为需求/实现对照，以下尚未执行代码修改。

| 图片与原型 | 批注要求 | 当前项目核对结果 | 后续落实方式 |
|---|---|---|---|
| 图 1 · P01 生产计划与派工 | 去掉红框“时间安排（近 10 天）”区域 | **尚未对齐。** 当前 P01 仍渲染“时间安排”卡片，列出近期工序并链接 P07。这项具体删除在上一份报告中没有单列。 | 删除 P01 的时间安排卡片，重新分配底部用料区域宽度，不留空占位。删除范围限于该卡片；P07 独立排程页面保留。 |
| 图 2 · P02 现场任务与不良登记 | “转质量协助”增加多部门选项 | **部分具备。** 原异常已有转协同能力，可选具有协同权限的人员；但当前是后续处理入口，选择框只列人名，没有 P02 图示位置的明确部门选项。 | 现场登记/初判衔接“转交协同”，可选质量、研发、采购等有效部门，再选实际接收人；沿用同一异常及历史，并衔接负责人初判和接收方确认。 |
| 图 3 · S10 收货检验与入库 | 用户已确认删除“发货单号”“关联异常”页面字段 | **需调整且涉及后台。** 当前正式字段名称是“送货单号”，手填必填并用于同订单行防重；异常号则已由检验结果自动创建/关联，并非要求用户手填。 | 收货表单去掉送货单号，同步取消对用户输入此字段的强制依赖；不再展示为必填/可编辑的关联异常表单项，继续自动产生和保留质量关联。 |
| 图 4 · P07 批次计划与工序安排 | 显示“工序＋件数” | **部分对齐。** 当前工序/任务名称在列表表头，日期格内仅显示数量、状态、负责人。且任务名称可能只是组件名称，不等于独立工序字段。 | 每个日计划项明确显示“工序名＋计划数量＋单位”，例如“密封检测 · 80 件”。同日多个工序分别展示，保留日期与产线组织；数量按实际单位使用件/台/套，不强制都改成件。 |

### 当前实现依据

- 图 1：[ProductionPlanningPage.tsx:39](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionPlanningPage.tsx:39) 仍有 `pp-schedule-preview` 时间安排卡片。
- 图 2：[ProductionExecutionPage.tsx:86](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionExecutionPage.tsx:86) 的协同选择仅按权限筛选人员并显示姓名；当前协同只有一个经办 `ownerId`，不是多部门并行会签。
- 图 3：[PurchaseReceiptDrawer.tsx:317](E:/workCoding/inogi-ai-office/src/app/order-processing/components/PurchaseReceiptDrawer.tsx:317) 登记收货；[purchase-receipts.dto.ts:9](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/dto/purchase-receipts.dto.ts:9) 要求 `deliveryNo` 非空；[purchase-receipts.service.ts:197](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-receipts.service.ts:197) 检查同订单行重复送货单；[自动建异常:282](E:/workCoding/inogi-ai-office/apps/api/src/modules/procurement/purchase-receipts.service.ts:282) 与原收货记录关联。
- 图 4：[ProductionSchedule.tsx:79](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionSchedule.tsx:79) 工序/任务名放在列头；[日计划项:82](E:/workCoding/inogi-ai-office/src/app/production/execution/ProductionSchedule.tsx:82) 只展示数量、状态及负责人。

### 实施边界与对上一份报告的修正

1. **“增加多部门选项”先解释为可向不同部门转交，不直接扩大为多个部门同时接单。** 图中没有明确并行会签；最小方案继续一个主经办，避免无人负责关闭。若后续要求并行协同，再补每个协同人的独立状态。
2. **删除页面字段不等于删除原业务数据。** 不清除历史送货信息或质量异常关系；原质量处置、复验、采购反馈和档案仍引用同一异常。该要求与上一份报告的数量闭环整改并不冲突。
3. **收货防重必须随字段删除一起调整。** 使用系统收货编号、请求幂等、采购订单行及数量校验；若有 ERP 来源单号可保留内部关联。内部编号不能伪装成供应商送货单号。仅有请求幂等不能完全替代外部送货凭证对同一实物重复登记的识别，应在实施验收中覆盖此边界。
4. **图 4 的展示要求不能替代工序约束。** 清晰显示工序和件数是页面修改；必要工序、前后关系、无领料工序仍分别对应 A02/A11，需要独立补业务规则。
5. **删除 P01 时间卡片不表示取消 P07。** 两张图合起来明确了分工：P01 做计划与派工，P07 集中做工序日程。上一轮 P01 保留了时间卡片，需按这次批注纠正。

以上为新增/细化的原型差异，不改变第 2 节既有 13 项已确认问题的统计。需求比对已补充，代码尚未据这四张批注修改。
