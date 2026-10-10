# Design QA — 生产与质量原型对照

final result: passed

历史记录：[本轮更新前的设计验收](E:/workCoding/inogi-ai-office/docs/production-rectification/archives/design-qa-before-2026-10-09.md)已存档。

日期：2026-10-09。通过范围：本轮页面布局、真实入口、交互可达性和已列明的适配取舍。**不是全业务闭环验收通过**；后台未闭环项见[整改结果](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-prototype-implementation-result.md)第四节。

## 对照来源与环境

原图目录：`C:/Users/Administrator/Documents/xwechat_files/zjw19920831_8887/msg/file/2026-09/INOGI_AI驾驶舱_V1.1全套开发资料_33页高保真/INOGI_AI驾驶舱_V1.1开发资料/高保真页面/`。

生产目录：P00_生产管理总览.png、P01_生产计划与派工.png、P02_现场任务与不良登记.png、P03_生产检验与复验.png、P04_生产问题转研发.png、P05_转产确认与批次档案.png、P06_生产全部任务.png、P07_批次计划与工序安排.png、P08_生产不良处理.png、P10_ECN变更查看与确认.png。供应链目录：S06_来料质量与原因分析.png、S10_收货检验与入库.png、S11_生产退料接收.png、S16_质量异常处置详情.png。

原始文件均为 1586×992 像素，逐文件路径与实测尺寸保存于 [source-dimensions.json](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/source-dimensions.json)。四张后补红字图片作为需求修订，不把截图上“去掉”“增加多部门选项”等批注带入产品界面。

实际渲染：`http://127.0.0.1:5198`，正式 React 页面组件、独立 Chrome、虚拟 API 数据。桌面 CSS viewport 1586×992，deviceScaleFactor=1，输出也是 1586×992；手机 390×844，关键状态补 320×844，均为 1 倍密度。无缩放修图。预览侧栏和“虚拟数据”标记仅属于验收外壳，未作为原图侧栏/logo逐像素评分。正式项目继续沿用现有全局导航。

状态差异：原图为 2026-09 演示数据，实现为 2026-10 多计划、跨月、长名称及真实缺失字段样例。数字、日期、记录数量、空证据和已发布状态不与原图数值硬对齐。S10 是现有抽屉、S16 是现有弹窗；用户授权不适配时调整，这两处保持同样的信息分区与原办理链。

## 五类必检项

| 表面 | 原图与实际对照结论 |
|---|---|
| 字体与层级 | 沿用项目字体及中文系统回退；标题 25–32px，正文 13–14px、辅助信息 12px 左右。表格及指标层级可辨；没有原字体文件，不宣称字形逐像素一致。P10 按钮挤压换行已修复，文件名允许自然换行 |
| 间距与布局节奏 | P00 指标/趋势/任务分区保留；P01 左表下用料右详情；P07 矩阵下三块；P04/P08 左列表右详情；S06 统计双栏；S10 三段办理＋侧栏；S16 三栏。P01/P07 的过高首屏和手机溢出问题完成迭代 |
| 色彩与状态 | 生产区与 S10 使用蓝白主调，合格绿、异常红/橙、未开始中性色。S11 沿用项目仓库工作台颜色，属于现有系统约束；不另建全局主题。状态均配文字，未只靠红黄灯 |
| 图片及资产 | 未将原图产品照片、图纸伪造成 CSS/SVG。正式页面读取真实受控文档/业务附件；不存在时显示文件入口或空态。预览唯一参考 PNG 明确命名“S10 原型参考图片”，不称现场证据。标准 Lucide 图标沿用项目 UI，不作为产品照片替代 |
| 文案与内容 | 保留原型标题/编号对应；生产单号统一主要展示名称，派工任务和来料批号不混为同一实体；报工、普通终检、闸门、QA 分别解释。S06 修正百分比后附“件”的量纲错误；未知数据不填 0 或静态演示人数 |

## 对照迭代记录

第一轮发现以下可执行问题，结果为 blocked；修复后均重新渲染检查。原图和实际图在同批图像输入中打开对照，不以文件路径或代码阅读代替目视检查。

| 问题及级别 | 修复 | 修复后证据 |
|---|---|---|
| P2 P01 行数与文档区过高，用料区域被挤下首屏 | 3 行分页、折叠文档，保持完整记录可达 | [P01 desktop](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/P01-desktop.png)；用料标题和首行进入首屏 |
| P2 P07 格内元信息重复、上部留白使底部三块在 y≈974 才露边 | 格内保留工序＋数量/单位，合并重复概览，缩减上部间距；未缩小工序字体 | [P07 desktop](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/P07-desktop.png)，三块从 y≈816 开始；[手机下部](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/P07-mobile-refined-lower.png) |
| P2 S06 显示“6.0% 件” | 改“件样本：6.0%”，不同单位分开 | [S06 desktop](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S06-desktop.png) |
| P2 S11 手机宽表将类型/状态放到屏外 | 手机改完整信息卡片，查看详情滚动并聚焦 | [390px 卡片](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S11-mobile-cards-390.png)、[320px 卡片](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S11-mobile-cards-320.png) |
| P2 P04/P08 手机后续阶段在横向屏外 | 5 阶段改 2 列换行，当前阶段边框/底色及 aria-current | [八个状态与尺寸结果](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-prototype-evidence/deep-interactions/browser-evidence.json)，待复验/关闭均显示第 4/5 阶段 |
| P2 P10 “查看固定版本”末字换行 | 去掉 5.5rem 上限，按钮不换行；长文件名列仍可换行 | [桌面修复](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-prototype-evidence/deep-interactions/P10-desktop-fixed.png)、[320px 长文件名](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-prototype-evidence/deep-interactions/P10-mobile-320-long-filename-documents.png) |
| P2 P03 检验弹窗的 fieldset 内容越过底部按钮，必填原因被遮挡 | 将表单与错误提示包入独立滚动容器，底部按钮固定并使用不透明背景；不改全局 Dialog 或提交逻辑 | [390/320/桌面三视口、9 张截图及必填/错误校验](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/inspection-dialog/browser-evidence.json) |

本轮最终未留下需处理的 P0/P1/P2 视觉问题。无外层横向溢出只是辅助证据，另行实际滚动检查了 P03 办理区、S16 处置区和 S11 详情。

## 全景与重点区域证据

全景截图位于 `E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/`，命名 `{P00,P01,P02,P03,P04,P05,P05-archive,P06,P07,P08,P10,S06,S16,S10,S11}-{desktop,mobile}.png`。其中后续修复后的 P10 以本报告链接的 `P10-desktop-fixed.png` 为最终依据，S11 手机以卡片截图为依据；旧截图保留表示迭代前状态，不混称最终。

P00/P05/P06/P10 已将原始 PNG 与实际桌面截图同批打开，P01/P07、P02/S10、S06/S16/S11/P03/P04/P08 也分别以原图＋实际桌面/手机同批对照。用户后补四图作为删除/修改依据。

重点状态：
- P03 手机检验表单：早期 P03-mobile-inspect-form.png 暴露了底部遮挡，作为修复前证据保留；最终以 [inspection-dialog 实际验收](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/inspection-dialog/browser-evidence.json)中的 9 张截图为准，必填项与错误均可滚达、底部按钮固定不透明。
- [S16 手机处置与复验](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S16-mobile-actions.png)：底部操作栏可达，未保存处置时复验禁用并解释。
- [S10 实收保存](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S10-receive-success.png)：无需发货单号，系统返回内部号；仅临时预览内存。
- [S10 附件查看](E:/workCoding/inogi-ai-office/docs/production-rectification/2026-10-09-requirements-evidence/S10-attachment-preview.png)：显示明确命名的原型参考图片。
- P02 协同下拉、P05 完整历史和 P06 原记录跳转截图均记录于上述 `deep-interactions/browser-evidence.json`。

## 实际交互与检查限制

通过：切型号清空原筛选、失效生产单恢复、IQC 真实路由链接、进入原任务检验、未处置禁止复验、无发货单号收货、零数量阻断、视频允许类型、图片预览、部门切换清接收人、ECN/转产深链、现场不良档案、手机详情定位。浏览器 pageerror 为 0。两处初次脚本定位失败来自错用按钮/标题名称，改用实际控件重测通过，记录已保留说明。

未以本轮验证替代：真实数据库事务/ERP 同步/附件远端存储、全角色生产环境数据、闸门与计划审批尚未实现的端到端流程。完整功能边界见整改结果，不属于视觉 passed 的承诺范围。
