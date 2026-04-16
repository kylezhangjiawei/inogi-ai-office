---

## Prompt 1 — 系统主导航 & 首页 Dashboard

```
Create a B2B enterprise dashboard home screen for "INOGI AI智能办公系统" with:

LAYOUT:
- Left sidebar (240px) with logo at top, navigation menu groups:
  · 首页 (Home) — active state
  · 售后工单 (After-sales)
  · 报关单证 (Customs Docs)
  · 资料库 (Knowledge Base)
  · 研发问题 (R&D Issues)
  · 质量管理 (QA)
  · 人事行政 (HR & Admin)
  · 系统设置 (Settings)
- Top header: breadcrumb, search bar, notification bell (with red badge "3"), user avatar

MAIN CONTENT — Dashboard with:

Row 1 — 4 stat cards (equal width):
  · "待处理工单" — number: 12 — red badge — icon: ticket
  · "本月报关单" — number: 8 — blue — icon: document
  · "资料待更新" — number: 3 — orange — icon: folder
  · "待审批任务" — number: 5 — purple — icon: checkmark

Row 2 — 2 columns:
  Left (60%): "近期工单状态" — horizontal bar chart showing:
    新建(4), 处理中(5), 待客户(2), 已完成(18) — use blue color ramp
  Right (40%): "快捷入口" — 2x3 grid of action buttons:
    · 新建售后工单
    · 上传报关单
    · 生成会议纪要
    · 查询注册进度
    · 简历筛选
    · 费用报销

Row 3 — "待办事项" table:
  Columns: 事项名称 | 来源模块 | 负责人 | 截止时间 | 状态
  Show 5 rows with status tags (待处理=red, 进行中=blue, 已完成=green)

Clean white card style, subtle shadows, enterprise feel.
```

---

## Prompt 2 — 售后工单：新建工单表单

```
Design a "新建售后工单" form page for a B2B enterprise system with:

LAYOUT: Single-column form inside a white card, max-width 760px, centered

HEADER: 
- Page title "新建售后工单" with back arrow
- Subtitle "请填写完整信息，系统将自动生成技术摘要"
- Progress indicator: 步骤1-填写信息 → 步骤2-AI生成摘要 → 步骤3-提交

FORM SECTIONS:

Section 1 "基础信息" (blue section header):
  - 客户名称* — text input
  - 产品型号* — dropdown (options: OC-3, OC-5, OC-10)
  - 序列号(S/N)* — text input with format hint "格式：XXXXXXXX"
  - 报障日期* — date picker

Section 2 "问题描述" (blue section header):
  - 问题类型* — tag selector (multiple choice pills):
    报警 | 不出氧 | 异常噪音 | 开机故障 | 其他
  - 档位/工作模式* — radio: 1档 | 2档 | 3档 | 持续流
  - 问题现象描述* — textarea (min 3 rows), placeholder "请详细描述问题现象"
  - 是否已自查* — radio: 是 | 否
  - 使用环境 — text input, placeholder "如：高原/沿海/室内"

Section 3 "附件上传" (blue section header):
  - S/N照片* — upload box with dashed border, icon, "点击或拖拽上传"
  - 报警/故障视频 — upload box
  - 其他附件 — upload box
  Each upload box shows accepted formats below

SMART VALIDATION BAR (sticky at bottom of form, above submit):
  Yellow warning bar showing: "⚠ 以下必填项未完成: 序列号、问题现象描述"
  When all filled: Green bar "✓ 信息完整，可提交"

FOOTER BUTTONS: 
  [保存草稿] (secondary) | [下一步：生成AI摘要 →] (primary blue, disabled until complete)
```

---

## Prompt 3 — 售后工单：AI 摘要生成 & 工单详情

```
Design a "售后工单详情" page showing AI-generated case summary for B2B enterprise:

LAYOUT: Two-column (left 65%, right 35%), full height

LEFT COLUMN — "工单详情":

Header card:
  - Case ID: "CS-2024-0892" (large monospace font, copyable)
  - 状态 tag: "处理中" (blue)
  - 创建时间: 2024-04-07 14:23
  - 优先级: P2 — 中等 (orange tag)

Info grid (2-column):
  客户: Medline International | 产品型号: OC-5
  S/N: 20240315001 | 报障日期: 2024-04-07
  问题类型: 不出氧 | 档位: 3档

AI生成摘要 card (light blue background #EBF3FB):
  Header: "✨ AI 技术摘要" with small "AI生成" badge
  Content sections:
  · 问题分类: 输出故障 — 流量不足
  · 复现条件: 持续使用3档模式下，2小时后触发
  · 已完成自查: 过滤棉清洁、电源检查
  · 缺失材料: 氧浓度检测视频（建议补充）
  · 优先级建议: P2，建议24h内响应
  Small disclaimer: "由AI生成，请技术人员复核"

附件列表: thumbnail grid showing uploaded files

操作日志 (timeline):
  · 2024-04-07 14:23 — 工单创建
  · 2024-04-07 14:24 — AI摘要生成完成
  · 2024-04-07 15:10 — 已转交技术部 (王工)

RIGHT COLUMN — "状态与操作":

状态流转 card:
  Vertical stepper:
    ✓ 新建 → ✓ AI摘要 → ● 技术处理 → ○ 待客户 → ○ 已关闭
  Current step highlighted in blue

操作按钮 card:
  [转交技术部 →] (primary)
  [标记: 待客户回复] (secondary)
  [关闭工单] (danger, outlined)

超时提醒 card (orange warning):
  "⏱ 距离超时提醒还有 8h 42m"
  Progress bar (30% red portion)

添加备注 card:
  Textarea + [添加备注] button
```

---

## Prompt 4 — 报关单证：字段提取与一致性校验

```
Design a "报关单证自动处理" page for trade documentation automation:

LAYOUT: Three-panel horizontal layout

PANEL 1 — LEFT (28%): "文件上传"
  Title: "上传源文件"
  Upload zone (large, dashed border):
    Icon + "上传 PI / 订单文件"
    "支持 PDF、Excel、Word"
  
  Already uploaded files list:
    · PI_Medline_2024Q2.pdf ✓ (green)
    · PO_20240407.xlsx ✓ (green)
  
  [开始提取字段 →] button (primary, full width)

PANEL 2 — CENTER (40%): "提取结果"
  Title: "AI字段提取结果" with "已提取 12/13 个字段" badge

  Extracted fields as an editable form:
    收货人: Medline International Inc. [edit icon]
    收货地址: 1 Medline Place, Mundelein, IL 60060, USA [edit icon]
    产品型号: OC-5 × 20台, OC-10 × 10台 [edit icon]
    数量: 30台 [edit icon]
    箱数: 15箱 [edit icon]
    毛重: 450 kg [edit icon]
    净重: 380 kg [edit icon]
    贸易条款: FOB Shanghai [edit icon]
    发票金额: USD 45,000.00 [edit icon]
    HS编码: ⚠ 未提取 [orange, manual input field]

  At bottom: [确认字段，生成单证 →] button

PANEL 3 — RIGHT (32%): "一致性校验"
  Title: "一致性校验报告"
  
  Overall status: large green checkmark "校验通过 9/10" 
  
  Checklist (each item with icon):
    ✓ 收货人信息一致 (green)
    ✓ 产品型号一致 (green)
    ✓ 数量一致: 30台 (green)
    ✓ 箱数一致: 15箱 (green)
    ⚠ 金额存在差异: PI显示$45,000 / PL显示$44,850 (orange, expandable)
    ✓ 重量一致 (green)
    ✓ 贸易条款一致 (green)

  Below checklist:
  "差异说明" expandable section for the warning item

  [导出校验报告 PDF] (outlined button)
  [生成CI/PL模板] (primary button)
```

---

## Prompt 5 — 客户询盘：AI 首轮回复生成

```
Design a "客户询盘处理" page for international sales inquiry management:

LAYOUT: Two-column split view

LEFT — "原始消息" (45%):
  Header: "WhatsApp 消息" with channel icon and timestamp "2024-04-07 09:15"
  
  Chat bubble style message (incoming, left-aligned, gray bubble):
    "Hi, we are a medical equipment distributor from Mexico. 
     Interested in your oxygen concentrator products. 
     Can you tell me the difference between OC-3 and OC-5? 
     Also what's your MOQ and lead time? 
     We might need around 100 units per year."
  
  Below message: AI识别结果 card (light purple background):
    消息类型: 型号咨询 + 询价
    识别语言: 英文
    客户地区: 墨西哥
    预估年需求: 约100台/年
    建议优先级: ⭐⭐⭐ 高潜力线索

RIGHT — "AI 回复生成" (55%):
  Header with toggle: [EN] [ES] language switch (EN selected)
  
  Reply draft in editable textarea (white card, generous padding):
    "Dear [Customer Name],
    
    Thank you for your interest in INOGI oxygen concentrators! 
    
    Regarding your question about OC-3 vs OC-5:
    · OC-3: 3L/min flow, suitable for mild-moderate COPD patients...
    · OC-5: 5L/min flow, recommended for moderate-severe cases...
    
    For an annual volume of ~100 units, our standard MOQ is 20 units 
    per order with a lead time of 4-6 weeks FOB Shanghai.
    
    To provide you with a formal quotation, could you share:
    ..."
  
  Below textarea:
  "需追问信息" card (yellow background):
    Checklist to include in reply:
    ☑ 目标国家/州（认证要求不同）
    ☑ 具体用途（家用/医疗机构）
    ☑ 付款方式偏好
    ☐ 是否需要西班牙语说明书

  台账字段输出 card (blue tinted):
    Title: "自动生成线索台账字段"
    客户名: — (待填写)
    国家: 墨西哥
    需求产品: OC-3 / OC-5
    年量预估: 100台
    当前阶段: 初步询盘
    下一步: 发送报价单

  Footer buttons: [重新生成] | [复制回复] | [一键发送 + 记录台账 →]
```

---

## Prompt 6 — 会议纪要：AI 自动生成

```
Design a "会议纪要生成" page for AI-powered meeting summary:

LAYOUT: Single column, max-width 900px, centered

STEP INDICATOR at top: 
  [1 输入内容] → [2 AI生成] → [3 确认发布] (step 2 active, blue)

INPUT CARD (collapsed, showing summary):
  "已输入：会议录音转写 (3,240字)" | [重新编辑] link

AI OUTPUT CARD — main content:
  Header: "✨ AI生成纪要" + "2024-04-07 14:00 | 市场部周会" + [编辑] [导出] buttons

  Section "会议结论":
    Numbered list (3 items, each editable inline):
    1. 决定Q2重点推进墨西哥市场，目标新增3家分销商
    2. 售后工单系统MVP计划5月15日前上线
    3. 认证资料需在4月30日前完成FDA文件补充

  Section "行动项" (key section, prominent):
    Table with columns: # | 行动项 | 负责人 | 截止时间 | 状态
    Row 1: 联系墨西哥3家目标客户 | 张明 | 04-14 | 待开始 [blue tag]
    Row 2: 完成工单系统UI设计稿 | 研发团队 | 04-20 | 进行中 [orange tag]
    Row 3: 补充FDA 510(k)资料清单 | RA专员李华 | 04-30 | 待开始 [blue tag]
    Row 4: 整理Q1销售数据并汇报 | 销售总监 | 04-12 | 已完成 [green tag]
    [+ 添加行动项] link at bottom

  Section "参会人员":
    Avatar chips: 张明 | 王芳 | 李华 | 陈工 | +2人

  Section "下次会议":
    "2024-04-14 14:00 | 市场部跟进会" [添加到日历] button

FOOTER ACTION BAR (sticky):
  [推送行动项给责任人] (primary) | [导出Word] | [导出PDF] | [分享链接]
```

---

## Prompt 7 — 研发问题：结构化提交 & 分流

```
Design a "研发问题提交" form page with smart routing for R&D issue management:

LAYOUT: Two-column (form left 60%, guidance right 40%)

LEFT — FORM:
  Title: "提交研发问题" with warning banner:
  "⚠ 信息不完整将无法提交 — 所有标*项必须填写"

  Section "产品信息":
    产品型号*: dropdown
    硬件版本*: text input placeholder "如: HW-v2.3.1"
    软件/固件版本*: text input placeholder "如: FW-1.4.2 / APP-2.1.0"
    BOM版本*: text input

  Section "问题描述":
    问题现象*: textarea with character counter (min 50 chars)
    问题类型*: 单选 radio cards (larger than normal radio):
      ◉ 硬件问题 (电路/结构/物料)
      ○ 软件问题 (Bug/逻辑/通讯)
      ○ 生产问题
      ○ 其他
    是否可复现*: Yes / No / 概率性复现 (segmented control)

  Section "附件":
    日志文件*: upload
    测试数据/截图: upload

  AI PRE-CHECK card (dynamic, updates as user types):
    Title: "提交前检查"
    ✓ 产品信息完整
    ⚠ 问题描述字数不足 (已填23/50字)
    ○ 日志文件未上传

  [提交并等待分流] button (disabled, grays out until all checks pass)

RIGHT — GUIDANCE PANEL:
  Title: "填写指南"
  
  "如何找到固件版本" expandable tip card
  
  AI智能匹配 (updates live):
    Card titled "相似历史问题"
    "发现 2 个可能相关的历史问题:"
    · Case #312: OC-5 3档模式流量异常 — 已解决 ✓
      [查看解决方案] link (green)
    · Case #287: 固件1.3.x兼容性问题 — 已解决 ✓
      [查看解决方案] link (green)
    "如果以上方案可解决您的问题，无需提交新工单。"

  分流说明 card:
    "提交后系统将自动判断:"
    → 已有解决方案 → 直接返回方案
    → 非研发问题 → 退回原部门
    → 非紧急 → 进入排队
    → 紧急研发问题 → 直接通知研发
```

---

## Prompt 8 — 质量管理：全链路追溯

```
Design a "全链路追溯查询" page for medical device quality traceability:

LAYOUT: Full width, vertical sections

TOP — SEARCH BAR:
  Large centered search area:
  Title: "全链路追溯查询"
  Segmented control: [批号查询] [序列号(SN)] [订单号]
  Large search input: "输入批号，如: 20240315-OC5-001" + [查询] button (primary)
  Currently showing result for: "批号 20240315-OC5-001"

RESULT AREA — Three panels in a horizontal connected flow:

PANEL 1 "向上追溯 — 原材料" (left, light green tint):
  Title: "↑ 原材料来源"
  Tree list:
    ▼ 压缩机 (大韦德) 
        批次: DW-20240310
        来料检验: ✓ 合格 | IQC-240310
    ▼ 分子筛 (国瑞材料)
        批次: GR-20240308
        来料检验: ✓ 合格
    ▼ 主板 PCB (振华)
        批次: ZH-20240312
        来料检验: ⚠ 让步接收 (orange)
  
  [查看来料检验报告] link

CENTER PANEL "生产过程" (highlighted with blue border — current focus):
  Title: "🏭 生产批次信息"
  批号: 20240315-OC5-001 (large, bold)
  产品型号: OC-5
  生产数量: 20台 | 合格: 19台 | 不合格: 1台
  
  工序时间线 (vertical):
    ✓ 组装 04-15 09:00 — 操作员: 王师傅
    ✓ 调试 04-15 14:00 — 操作员: 李工
    ✓ FQC检验 04-16 — QA: 陈检 — 结果: 合格
    ✓ 包装 04-17
    ✓ 放行 04-17 — QA主管审批

PANEL 3 "向下追溯 — 销售/售后" (right, light blue tint):
  Title: "↓ 销售去向"
  List of serial numbers shipped:
    SN: OC5-2024-001 → Medline Mexico | 04-20出库
    SN: OC5-2024-002 → Medline Mexico | 04-20出库
    ... 18台已出库
    SN: OC5-2024-019 → 库存 (green tag)
    SN: OC5-2024-020 → 🔴 售后工单CS-892 (red, clickable)

BOTTOM — Actions:
  [导出追溯报告 PDF] | [发起召回评估] (danger outlined) | [打印追溯链路]
```

---

## Prompt 9 — 人事行政：简历筛选

```
Design a "AI简历筛选" page for HR recruitment management:

LAYOUT: Two-column (list left 40%, detail right 60%)

TOP BAR (full width):
  当前职位: "市场专员 — 国际销售方向" [切换职位 ▾]
  Stats: 收到简历 47份 | AI筛选完成 47份 | 推荐面试 8份
  Filters: [全部] [强烈推荐] [建议面试] [待评估] [不符合]

LEFT PANEL — CANDIDATE LIST:
  Sorted by AI match score, each card shows:
  
  Card 1 (selected state, blue border):
    Avatar initials + 张晓雯 | 28岁
    ⭐⭐⭐⭐⭐ 94分 — 强烈推荐 (green badge)
    上海外国语大学 | 国际贸易 | 3年外贸经验
    西班牙语CET-8 ✓ | 医疗器械行业 ✓
  
  Card 2:
    李明远 | 31岁
    ⭐⭐⭐⭐ 81分 — 建议面试 (blue badge)
    有医疗器械销售经验 | 英语流利
  
  Card 3:
    王芳芳 | 25岁  
    ⭐⭐⭐ 67分 — 待评估 (gray badge)
  
  [+ 上传更多简历] at bottom

RIGHT PANEL — CANDIDATE DETAIL:
  Header: "张晓雯" + 94分 badge + [安排面试] button (primary)
  
  AI分析报告 card (the key feature):
    Title: "✨ AI综合评估"
    
    匹配优势 (green section):
      ✓ 西班牙语CET-8，满足拉美市场需求
      ✓ 3年医疗器械外贸经验（体外诊断产品）
      ✓ 有独立开发客户经验，拿下3个海外代理商
    
    待确认项 (orange section):
      ? 制氧机品类未接触过，学习曲线待评估
      ? 期望薪资18K，超出岗位预算2K
    
    不符合项 (red, none in this case):
      — 无明显不符合项
    
    建议沟通问题 card:
      "递进式沟通建议 (第1轮):"
      1. "请介绍一下您在上一家公司最成功的海外客户开发案例"
      2. "您对制氧机这类医疗耗材类产品的了解程度如何？"
  
  Resume preview section (scrollable):
    Actual resume content displayed below

BOTTOM: [发送面试邀请] | [进入下一轮沟通] | [标记不符合]
```

---

## Prompt 10 — 费用报销：OCR 识别与月度统计

```
Design a "费用报销管理" page with OCR receipt processing and monthly analytics:

LAYOUT: Tab-based page
Active Tab: [发票上传] | [月度统计] | [报销记录]

— TAB 1: 发票上传 —

Two-column layout:

LEFT (45%) — Upload Zone:
  Large dashed upload area:
    Camera icon + "拍照上传 / 拖拽上传"
    "支持: 增值税发票、收据、出租车票"
  
  已上传列表 (3 items):
    📄 增值税发票_餐饮.jpg — ✓ 识别成功
    📄 出租车票_0407.jpg — ✓ 识别成功  
    📄 住宿发票_杭州.jpg — ⚠ 金额模糊，请确认

RIGHT (55%) — OCR Results:
  Currently showing: "增值税发票_餐饮.jpg"
  
  Extracted fields (editable):
    发票类型: 增值税普通发票
    发票号码: 12345678
    开票日期: 2024-04-07
    销售方: 外滩18号餐厅
    金额: ¥ 1,280.00
    税额: ¥ 115.20
    含税合计: ¥ 1,395.20
    费用分类: [业务招待费 ▾] (auto-classified, editable dropdown)
    项目归属: [Q2拉美客户拜访 ▾]
    报销人: 张明 (auto-filled)
  
  [确认并保存] button

Missing info alert (yellow bar): "⚠ 缺少：审批人签字"

— TAB 2: 月度统计 —

Header: "2024年04月 费用统计" [◀ 上月] [本月 ▾]
Total: "本月已报销 ¥ 28,450"

Donut chart (center) showing expense categories:
  业务招待: 35% | 差旅交通: 28% | 办公耗材: 15% | 其他: 22%

Bar chart below: Daily expense trend for the month

Summary table:
  类别 | 金额 | 占比 | 与上月对比
  业务招待费 | ¥9,957 | 35% | ▲ 12%
  差旅交通 | ¥7,966 | 28% | ▼ 5%
  ...

[导出月度报表 Excel] | [发送给财务]
```

---

## Prompt 11 — 法规知识库（RA 模块）

```
Design a "法规知识库" page for regulatory affairs document management:

LAYOUT: Three-panel (left nav 220px, center content 55%, right detail 30%)

LEFT PANEL — Category Navigation:
  Title: "法规体系"
  Tree navigation:
    ▼ NMPA (中国)
        ▼ 法规文件 (12)
            · 医疗器械注册管理办法
            · 制氧机产品注册技术审查指导原则 ← (selected, highlighted)
        ▶ 指导原则 (8)
        ▶ 管理规范 (5)
    ▶ FDA (美国) (24)
    ▶ MDR (欧盟) (18)
  
  Quick filters below:
    [全部] [制氧机] [报警系统] [软件] [临床评价]

CENTER — SEARCH + RESULTS:
  Large search bar: "搜索条款、要求、产品模块..."
  Current search: "报警优先级" — showing results
  
  Result count: "找到 7 个相关条款"
  
  Result cards (each):
    Card 1 (highlighted, from selected doc):
      [NMPA · 指导原则] tag
      "第五章 第3.2条 — 报警系统要求"
      Excerpt with keyword highlighted: "...制氧机应具备声光报警功能，报警**优先级**分为高、中、低三级..."
      RA专员注释 tag: "已标注合规要点" (blue badge)
      [跳转原文] [收藏] buttons
    
    Card 2: [FDA · 21 CFR 868] tag — similar layout
    Card 3: [MDR · Annex I] tag
  
  场景化检索 chips below results:
    "注册申报场景" | "变更申报场景" | "软件升级场景"

RIGHT PANEL — Document Preview:
  Document title: "制氧机产品注册技术审查指导原则"
  Version: V2.0 | 发布: 2023-06 | 状态: 现行有效 (green)
  
  Mini table of contents (scrollable, clickable chapters)
  
  "已跳转至第五章 3.2条" — highlighted section preview
  
  关联条款 card:
    "→ FDA 21 CFR 868.5895 对应条款"
    "→ MDR Annex I Chapter II 对应要求"
  
  RA专员注释 card (yellow tint):
    "合规要点: 需提供声光报警测试报告，含三级优先级验证数据"
    — 李华 RA专员 | 2024-03-15
  
  [下载原文] [生成合规报告] buttons
```

---

## Prompt 12 — 移动端：主要功能快捷入口

```
Design a mobile app screen (iPhone 14 Pro size, 393×852px) for INOGI AI办公助手:

STYLE: Clean iOS-style, bottom tab navigation, white background

TOP: Status bar + App header "INOGI 助手" + notification bell

GREETING CARD (full width, blue gradient):
  "早上好，张明 👋"
  "今日待处理: 3项工单 | 1份报关单 | 2个行动项"

QUICK ACTIONS GRID (2×3):
  [📋 新建工单] [📄 上传发票]
  [🎤 记录会议] [🔍 法规检索]
  [📦 追溯查询] [💬 生成回复]

TODAY'S TASKS card:
  Title: "今日待办" with badge "5"
  List items with checkboxes:
    ○ 回复Medline询价邮件 — 截止今日
    ○ 审核工单CS-892摘要 — 2h后超时 ⚠
    ✓ 上传Q2 PI文件 — 已完成
  [查看全部 →]

RECENT card:
  "最近处理"
  · 工单 CS-890 — 已关闭 ✓
  · 会议纪要 — 市场部周会 04-07
  · 简历筛选 — 市场专员岗位 8/47

BOTTOM TAB BAR (5 tabs):
  首页 | 工单 | AI助手 (center, prominent) | 文件 | 我的
```

---

## 使用建议

| 工具 | 粘贴方式 | 适用 Prompt |
|------|---------|------------|
| **Figma AI (Make Designs)** | 直接粘贴到 Make Designs 对话框 | 所有 Prompt |
| **Figma + Magician Plugin** | 选中 Frame → 输入 Prompt | Prompt 2-11 |
| **v0.dev** | 直接粘贴，生成 React 代码后导入 | 推荐 Prompt 2, 4, 5, 6 |
| **Builder.io AI** | 粘贴到 "Generate UI" | 所有 Prompt |
| **Galileo AI** | 作为设计描述输入 | 推荐复杂页面 3, 8, 11 |

**推荐生成顺序：** 首页(1) → 工单核心流程(2→3) → 报关(4) → 询盘(5) → 纪要(6) → 追溯(8) → 移动端(12)
