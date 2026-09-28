# 03 · 页面与功能清单

审计日期：2026-09-17。以当前 App 路由注册为页面可达性依据，组件文件名不等于页面。功能与承载建议见下方业务清单；菜单权限详见 [导航地图](02-navigation-map.md)。

## 路由注册逐项核对

包括布局、重定向和兜底，因此本表行数不等于独立业务页面数量。URL 为内置默认值；`routePath` 可受配置覆盖。`KB_PAGE_PERMISSIONS` 为研发库及 13 个部门库页面权限的任一项。详情及讨论页还有组件/服务端对象范围检查。

| 默认 URL / 模式 | 当前组件 | 类型 | 路由层门槛 | 注册证据 |
| --- | --- | --- | --- | --- |
| `/login` | LoginPage | 公开入口 | 无内部登录门槛；表单链接另校验 | [App:489](../../src/app/App.tsx#L489) |
| `/apply/:slug` | PublicApplicantFormPage | 公开入口 | 无内部登录门槛；表单链接另校验 | [App:490](../../src/app/App.tsx#L490) |
| `/__preview` | PreviewIndexPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:491](../../src/app/App.tsx#L491) |
| `/__preview/monthly-readiness` | MonthlyReadinessPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:492](../../src/app/App.tsx#L492) |
| `/__preview/key-materials` | KeyMaterialsPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:493](../../src/app/App.tsx#L493) |
| `/__preview/company-overview` | CompanyOverviewPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:494](../../src/app/App.tsx#L494) |
| `/__preview/receipt-disposition` | ReceiptDispositionPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:495](../../src/app/App.tsx#L495) |
| `/__preview/quality-exceptions` | QualityExceptionsPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:496](../../src/app/App.tsx#L496) |
| `/__preview/warehouse` | WarehousePreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:497](../../src/app/App.tsx#L497) |
| `/__preview/shipments` | ShipmentPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:498](../../src/app/App.tsx#L498) |
| `/__preview/batch-archives` | BatchArchivePreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:499](../../src/app/App.tsx#L499) |
| `/__preview/ecn` | EcnPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:500](../../src/app/App.tsx#L500) |
| `/__preview/production-planning` | PlanningPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:501](../../src/app/App.tsx#L501) |
| `/__preview/production-defects` | DefectPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:502](../../src/app/App.tsx#L502) |
| `/__preview/production-rd` | ProductionRdPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:503](../../src/app/App.tsx#L503) |
| `/__preview/production-transfer` | TransferPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:504](../../src/app/App.tsx#L504) |
| `/__preview/production-overview` | ProductionOverviewPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:505](../../src/app/App.tsx#L505) |
| `/__preview/production-tasks` | ProductionTasksPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:506](../../src/app/App.tsx#L506) |
| `/__preview/production-inspections` | InspectionPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:507](../../src/app/App.tsx#L507) |
| `/__preview/field-tasks` | FieldPreviewPage | DEV 预览 | 仅开发构建；无外层登录门槛 | [App:508](../../src/app/App.tsx#L508) |
| `/` | ProtectedLayout | 布局 | 登录/组件内部校验 | [App:509](../../src/app/App.tsx#L509) |
| `/` | Dashboard | 桌面入口 | routePermissionMap["/"] ?? "page:dashboard" | [App:513](../../src/app/App.tsx#L513) |
| `/profile` | PersonalCenterPage | 桌面入口 | 登录/组件内部校验 | [App:514](../../src/app/App.tsx#L514) |
| `/message-center` | MessageCenterPage | 桌面入口 | 登录/组件内部校验 | [App:515](../../src/app/App.tsx#L515) |
| `/after-sales` | AfterSalesList | 桌面入口 | page:after-sales | [App:516](../../src/app/App.tsx#L516) |
| `/after-sales/new` | AfterSalesForm | 桌面入口 | page:after-sales | [App:517](../../src/app/App.tsx#L517) |
| `/after-sales/:id` | AfterSalesDetails | 桌面入口 | page:after-sales | [App:518](../../src/app/App.tsx#L518) |
| `/rd-task-management` | RDTaskManagementPage | 桌面入口 | page:rd-task-management | [App:522](../../src/app/App.tsx#L522) |
| `/issue-ai` | IssueAiModule | 桌面入口 | page:issue-ai | [App:523](../../src/app/App.tsx#L523) |
| `/rd-people-management` | RDPeopleManagementPage | 桌面入口 | rd-people:manage | [App:525](../../src/app/App.tsx#L525) |
| `/rd-my-workspace` | RDMyWorkspacePage | 桌面入口 | page:rd-my-workspace | [App:526](../../src/app/App.tsx#L526) |
| `/rd-discussion/:taskId` | RDDiscussionInvitePage | 桌面入口 | 登录/组件内部校验 | [App:527](../../src/app/App.tsx#L527) |
| `/rd-sheet` | RDSheetPage | 桌面入口 | page:rd-sheet | [App:528](../../src/app/App.tsx#L528) |
| `/rd-knowledge-base` | KnowledgeBaseEntryPage | 桌面入口 | page:rd-knowledge-base | [App:530](../../src/app/App.tsx#L530) |
| `/dept-kb` | KnowledgeBaseEntryPage | 桌面入口 | KB_PAGE_PERMISSIONS | [App:533](../../src/app/App.tsx#L533) |
| `/dept-kb/:id` | KnowledgeBaseEntryPage | 桌面入口 | KB_PAGE_PERMISSIONS | [App:534](../../src/app/App.tsx#L534) |
| `/us-collab-cockpit` | RDTaskManagementPage | 桌面入口 | page:us-collab-cockpit | [App:536](../../src/app/App.tsx#L536) |
| `/us-collab-workspace` | RDMyWorkspacePage | 桌面入口 | page:us-collab-workspace | [App:537](../../src/app/App.tsx#L537) |
| `/us-collab-rd-discussion/:taskId` | RDDiscussionInvitePage | 桌面入口 | 登录/组件内部校验 | [App:538](../../src/app/App.tsx#L538) |
| `/us-collab-people-management` | RDPeopleManagementPage | 桌面入口 | rd-people:manage | [App:540](../../src/app/App.tsx#L540) |
| `/production-people-management` | RDPeopleManagementPage | 桌面入口 | rd-people:manage | [App:541](../../src/app/App.tsx#L541) |
| `/us-collab-task/:taskId` | UsCollabTaskDetailPage | 桌面入口 | 登录/组件内部校验 | [App:543](../../src/app/App.tsx#L543) |
| `/rd-task/:taskId` | RDTaskDetailPage | 桌面入口 | 登录/组件内部校验 | [App:545](../../src/app/App.tsx#L545) |
| `/production-task/:taskId` | RDTaskDetailPage | 桌面入口 | page:rd-director-dashboard | [App:546](../../src/app/App.tsx#L546) |
| `/us-collab-kb` | RDKnowledgeBasePage | 桌面入口 | page:dept-kb-us-collab | [App:547](../../src/app/App.tsx#L547) |
| `/us-collab-approval-flow` | RDApprovalFlowPage | 桌面入口 | page:us-collab-approval-flow | [App:551](../../src/app/App.tsx#L551) |
| `/us-collab-audit-log` | Navigate | 重定向 | 登录/组件内部校验 | [App:552](../../src/app/App.tsx#L552) |
| `/us-collab-ai-settings` | RDAiSettingsPage | 桌面入口 | page:us-collab-ai-settings | [App:553](../../src/app/App.tsx#L553) |
| `/production-dashboard` | ProductionDashboardRoute | 桌面入口 | page:rd-director-dashboard | [App:555](../../src/app/App.tsx#L555) |
| `/rd-director-dashboard` | Navigate | 重定向 | page:rd-director-dashboard | [App:556](../../src/app/App.tsx#L556) |
| `/rd-approval-flow` | RDApprovalFlowPage | 桌面入口 | page:rd-approval-flow | [App:557](../../src/app/App.tsx#L557) |
| `/rd-audit-log` | Navigate | 重定向 | 登录/组件内部校验 | [App:558](../../src/app/App.tsx#L558) |
| `/audit-log` | AuditLogPage | 桌面入口 | page:audit-log | [App:560](../../src/app/App.tsx#L560) |
| `/rd-ai-settings` | RDAiSettingsPage | 桌面入口 | page:rd-ai-settings | [App:561](../../src/app/App.tsx#L561) |
| `/rd-triage` | RDIssues | 桌面入口 | page:rd-triage | [App:562](../../src/app/App.tsx#L562) |
| `/registration-projects` | RegistrationProjects | 桌面入口 | page:registration-projects | [App:563](../../src/app/App.tsx#L563) |
| `/bom-archive` | BOMArchive | 桌面入口 | page:bom-archive | [App:564](../../src/app/App.tsx#L564) |
| `/design-changes` | DesignChangesPage | 桌面入口 | page:design-changes | [App:565](../../src/app/App.tsx#L565) |
| `/customs-ai` | CustomsAI | 桌面入口 | page:customs-ai | [App:566](../../src/app/App.tsx#L566) |
| `/customs-docs` | CustomsDocs | 桌面入口 | page:customs-docs | [App:567](../../src/app/App.tsx#L567) |
| `/external-docs` | ExternalDocsPage | 桌面入口 | page:external-docs | [App:568](../../src/app/App.tsx#L568) |
| `/ra-knowledge` | RAKnowledgePage | 桌面入口 | page:ra-knowledge | [App:569](../../src/app/App.tsx#L569) |
| `/quality-dms` | QualityDMSPage | 桌面入口 | page:quality-dms | [App:570](../../src/app/App.tsx#L570) |
| `/qa-traceability` | QATraceability | 桌面入口 | page:qa-traceability | [App:571](../../src/app/App.tsx#L571) |
| `/order-workbench` | OrderWorkbenchPage | 桌面入口 | page:order-workbench | [App:572](../../src/app/App.tsx#L572) |
| `/purchase-orders` | PurchaseOrdersPage | 桌面入口 | page:purchase-orders | [App:573](../../src/app/App.tsx#L573) |
| `/purchase-orders/:id` | PurchaseOrderDetailPage | 桌面入口 | page:purchase-order-detail | [App:577](../../src/app/App.tsx#L577) |
| `/inventory-management` | InventoryManagementPage | 桌面入口 | page:inventory-management | [App:578](../../src/app/App.tsx#L578) |
| `/proc-cockpit` | ProcurementCockpitPage | 桌面入口 | page:proc-cockpit | [App:579](../../src/app/App.tsx#L579) |
| `/proc-my-workspace` | ProcMyWorkspacePage | 桌面入口 | page:proc-my-workspace | [App:581](../../src/app/App.tsx#L581) |
| `/proc-materials` | MaterialWorkbenchPage | 桌面入口 | page:proc-materials | [App:582](../../src/app/App.tsx#L582) |
| `/proc-key-materials` | KeyMaterialsPage | 桌面入口 | page:proc-key-materials | [App:583](../../src/app/App.tsx#L583) |
| `/production-execution` | ProductionExecutionPage | 桌面入口 | page:production-execution | [App:584](../../src/app/App.tsx#L584) |
| `/warehouse-flow` | WarehouseFlowPage | 桌面入口 | ["page:warehouse-flow", "page:production-execution"] | [App:585](../../src/app/App.tsx#L585) |
| `/proc-inventory-readiness` | InventoryReadinessPage | 桌面入口 | page:proc-inventory-readiness | [App:586](../../src/app/App.tsx#L586) |
| `/proc-quote-book` | QuoteBookPage | 桌面入口 | page:proc-quote-book | [App:587](../../src/app/App.tsx#L587) |
| `/proc-audit-log` | Navigate | 重定向 | 登录/组件内部校验 | [App:588](../../src/app/App.tsx#L588) |
| `/proc-people-management` | ProcPeopleManagementPage | 桌面入口 | page:proc-cockpit | [App:593](../../src/app/App.tsx#L593) |
| `/proc-operational-tasks` | OperationalTasksPage | 桌面入口 | page:purchase-order-detail | [App:594](../../src/app/App.tsx#L594) |
| `/resume-screening` | ResumeScreeningPage | 桌面入口 | page:resume-screening | [App:595](../../src/app/App.tsx#L595) |
| `/employee-archive` | EmployeeArchivePage | 桌面入口 | page:employee-archive | [App:596](../../src/app/App.tsx#L596) |
| `/applicant-forms` | ApplicantFormsPage | 桌面入口 | page:applicant-forms | [App:597](../../src/app/App.tsx#L597) |
| `/attendance` | AttendancePage | 桌面入口 | page:quick-capture | [App:598](../../src/app/App.tsx#L598) |
| `/quick-capture` | Navigate | 重定向 | page:quick-capture | [App:601](../../src/app/App.tsx#L601) |
| `/expense-center` | ExpenseCenterPage | 桌面入口 | page:expense-center | [App:602](../../src/app/App.tsx#L602) |
| `/ebpr` | EBPRPage | 桌面入口 | page:ebpr | [App:603](../../src/app/App.tsx#L603) |
| `/inspection-release` | InspectionReleasePage | 桌面入口 | page:inspection-release | [App:604](../../src/app/App.tsx#L604) |
| `/bug-log` | BugLogPage | 桌面入口 | page:bug-log | [App:605](../../src/app/App.tsx#L605) |
| `/contract-review` | ContractReviewPage | 桌面入口 | page:contract-review | [App:606](../../src/app/App.tsx#L606) |
| `/electronic-gate` | ElectronicGatePage | 桌面入口 | page:electronic-gate | [App:607](../../src/app/App.tsx#L607) |
| `/device-inspection-records` | DeviceInspectionRecordsPage | 桌面入口 | page:device-inspection-records | [App:608](../../src/app/App.tsx#L608) |
| `/mailbox-management` | MailboxManagementPage | 桌面入口 | page:mailbox-management | [App:609](../../src/app/App.tsx#L609) |
| `/ai-model-management` | AiModelManagementPage | 桌面入口 | page:ai-model-management | [App:610](../../src/app/App.tsx#L610) |
| `/ai-usage` | AiUsageDashboardPage | 桌面入口 | page:ai-usage-dashboard | [App:611](../../src/app/App.tsx#L611) |
| `/content-slots` | ContentSlotsPage | 桌面入口 | page:content-slots | [App:612](../../src/app/App.tsx#L612) |
| `/chat-analytics` | ChatAnalyticsPage | 桌面入口 | page:chat-analytics | [App:613](../../src/app/App.tsx#L613) |
| `/i18n-management` | I18nManagementPage | 桌面入口 | i18n:manage | [App:614](../../src/app/App.tsx#L614) |
| `/ocr-config-management` | OcrConfigManagementPage | 桌面入口 | page:ocr-config-management | [App:615](../../src/app/App.tsx#L615) |
| `/ops-center` | OpsCenterPage | 桌面入口 | page:ops-center | [App:616](../../src/app/App.tsx#L616) |
| `/ops-center/api-errors` | OpsCenterPage | 桌面入口 | page:ops-api-errors | [App:617](../../src/app/App.tsx#L617) |
| `/ops-center/database` | OpsCenterPage | 桌面入口 | page:ops-database | [App:618](../../src/app/App.tsx#L618) |
| `/ops-center/services-tasks` | OpsCenterPage | 桌面入口 | page:ops-services-tasks | [App:619](../../src/app/App.tsx#L619) |
| `/ops-center/alerts-audit` | OpsCenterPage | 桌面入口 | page:ops-alerts-audit | [App:620](../../src/app/App.tsx#L620) |
| `/inquiry` | InquiryPage | 桌面入口 | page:inquiry | [App:621](../../src/app/App.tsx#L621) |
| `/meeting` | MeetingMinutes | 桌面入口 | page:meeting | [App:622](../../src/app/App.tsx#L622) |
| `/email-ai` | EmailAIPage | 桌面入口 | page:email-ai | [App:623](../../src/app/App.tsx#L623) |
| `/report-compression` | ReportCompressionPage | 桌面入口 | page:report-compression | [App:624](../../src/app/App.tsx#L624) |
| `/downloads` | DownloadTutorialPage | 桌面入口 | page:downloads | [App:625](../../src/app/App.tsx#L625) |
| `/downloads/:platformId` | PlatformTutorialPage | 桌面入口 | page:downloads | [App:626](../../src/app/App.tsx#L626) |
| `/manual` | ManualPage | 桌面入口 | page:manual | [App:628](../../src/app/App.tsx#L628) |
| `/manual/:topicId` | ManualTopicPage | 桌面入口 | page:manual | [App:629](../../src/app/App.tsx#L629) |
| `/departments` | DepartmentManagement | 桌面入口 | page:departments | [App:630](../../src/app/App.tsx#L630) |
| `/users` | UserManagement | 桌面入口 | page:users | [App:631](../../src/app/App.tsx#L631) |
| `/roles` | RoleManagement | 桌面入口 | page:roles | [App:632](../../src/app/App.tsx#L632) |
| `/route-management` | RouteManagementPage | 桌面入口 | page:route-management | [App:633](../../src/app/App.tsx#L633) |
| `/settings` | DictionaryList | 桌面入口 | page:settings | [App:634](../../src/app/App.tsx#L634) |
| `/ui-design` | UIDesignPage | 桌面入口 | page:ui-design | [App:635](../../src/app/App.tsx#L635) |
| `/image-library` | ImageLibraryPage | 桌面入口 | page:image-library | [App:636](../../src/app/App.tsx#L636) |
| `/video-library` | VideoLibraryPage | 桌面入口 | page:video-library | [App:637](../../src/app/App.tsx#L637) |
| `/*` | Navigate → / | 兜底重定向 | 登录/组件内部校验 | [App:638](../../src/app/App.tsx#L638) |
| `/m` | ResponsiveMobileLayout | 布局 | 登录/组件内部校验 | [App:641](../../src/app/App.tsx#L641) |
| `/m` | MobileRDCockpit | 移动视图 | ["page:rd-task-management", "page:rd-my-workspace"] | [App:647](../../src/app/App.tsx#L647) |
| `/m/task/:taskId` | MobileRDCockpit | 移动视图 | ["page:rd-task-management", "page:rd-my-workspace"] | [App:648](../../src/app/App.tsx#L648) |
| `/m/discussion/:taskId` | RDDiscussionInvitePage | 移动视图 | 登录/组件内部校验 | [App:649](../../src/app/App.tsx#L649) |
| `/m/chat-analytics` | MobileChatAnalyticsPage | 移动视图 | page:chat-analytics | [App:650](../../src/app/App.tsx#L650) |
| `/m/*` | Navigate | 重定向 | 登录/组件内部校验 | [App:651](../../src/app/App.tsx#L651) |
| `/us-collab-m` | ResponsiveMobileLayout | 布局 | 登录/组件内部校验 | [App:654](../../src/app/App.tsx#L654) |
| `/us-collab-m` | MobileRDCockpit | 移动视图 | page:us-collab-cockpit | [App:659](../../src/app/App.tsx#L659) |
| `/us-collab-m/task/:taskId` | MobileRDCockpit | 移动视图 | page:us-collab-cockpit | [App:660](../../src/app/App.tsx#L660) |
| `/us-collab-m/discussion/:taskId` | RDDiscussionInvitePage | 移动视图 | 登录/组件内部校验 | [App:661](../../src/app/App.tsx#L661) |
| `/us-collab-m/*` | Navigate | 重定向 | 登录/组件内部校验 | [App:662](../../src/app/App.tsx#L662) |
| `/production-m` | ResponsiveMobileLayout | 布局 | 登录/组件内部校验 | [App:665](../../src/app/App.tsx#L665) |
| `/production-m` | MobileRDCockpit | 移动视图 | page:rd-director-dashboard | [App:670](../../src/app/App.tsx#L670) |
| `/production-m/task/:taskId` | MobileRDCockpit | 移动视图 | page:rd-director-dashboard | [App:671](../../src/app/App.tsx#L671) |
| `/production-m/*` | Navigate | 重定向 | 登录/组件内部校验 | [App:672](../../src/app/App.tsx#L672) |


## 业务页面逐页盘点

A=当前源码接后端；D=日常路由上的本地演示；P=仅开发预览；R=入口/静态内容/兼容。主表每行说明用户业务目标、主要功能以及当前承载方式。各页面权限与默认路径在前表逐项登记，此处不重复长权限表达式。静态演示的按钮只代表界面表达的功能，不代表真实发送、审批或留档。

### 总览与个人入口

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 登录 /login | 进入获授权工作区 | 账号/密码表单，恢复原访问目标；登录背景素材 | A · [Login](../../src/app/LoginPage.tsx)、auth/me/login |
| 系统首页 / | 从个人待办进入研发、问题、费用、客户订单 | 指标下钻、待办、趋势、刷新；开发构建有业务预览入口 | A · [Dashboard](../../src/app/Dashboard.tsx)、dashboardApi 聚合各业务 |
| 个人中心 /profile | 维护本人资料与账号安全 | 头像上传/默认图库、英文名、邮箱、密码；中文姓名等只读 | A · [PersonalCenter](../../src/app/PersonalCenterPage.tsx)、auth |
| 消息中心 /message-center | 处理通知、讨论邀请及审批请求 | 分类/状态筛选、已读/处理、进入原任务；审批通过/打回及原因、绩效评分弹窗；样品与转采购通知 | A · [MessageCenter](../../src/app/MessageCenterPage.tsx)、rdApi/procurementApi |
| MateChat（顶栏，无页面路由） | 在工作上下文问答、取资料与确认 AI 动作 | 大型对话弹层、会话历史、模型/附件、引用、反馈、分享；动作确认卡、结项检查、文件选择和资料包 | A · [MateChatBubble](../../src/app/components/MateChatBubble.tsx)、chat/archives/delivery-checks；不是全部业务统一待办 |

### 研发与中美协同

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 研发任务驾驶舱 /rd-task-management | 管理产品任务、人员负载、风险与决策 | 产品/系统/子系统/任务树、搜索、人员与状态筛选、AI 立项、创建/移动/合并/转派、报告、绩效；进入人员管理与任务详情 | A · [RDTaskManagement](../../src/app/RDTaskManagementPage.tsx)、rdApi |
| 研发个人工作台 /rd-my-workspace | 推进自己的主责/协作任务 | 主责/协助切换、类目树、状态/期限筛选；任务操作弹层含详情/讨论/更新进度/移交协作/提交结果；通知、AI 建议、AI 立项 | A · [RDMyWorkspace](../../src/app/RDMyWorkspacePage.tsx)；进度、成果与审批不同动作 |
| 研发任务详情 /rd-task/:taskId | 集中核对一项任务的事实与交付 | 顶部任务操作、人员、子任务、合并关系；进展留痕/讨论/操作记录/合并关系/采购与样品/技术资料；编辑、AI 小结、问 MateChat、转采购、提交审核等 | A · [RDTaskDetail](../../src/app/RDTaskDetailPage.tsx)；Tab 依工作区/关联状态变化 |
| 研发人员管理 /rd-people-management | 配置任务成员、容量、状态与知识库等级 | 搜索/状态/所属组、成员表、负载下钻；新增/编辑/删除成员表单 | A · [RDPeopleManagement](../../src/app/RDPeopleManagementPage.tsx)；rd-people:manage |
| 研发讨论 /rd-discussion/:taskId | 受邀参与特定任务线程 | 线程上下文、讨论回复、返回；不扩大至全部任务数据 | A · [RDDiscussionInvite](../../src/app/RDDiscussionInvitePage.tsx) |
| 研发数据表 /rd-sheet | 维护共享研发工作簿 | 多工作表编辑、xlsx 导入、保存、撤销、自动本机草稿、最近 10 版恢复、图片及行高处理 | A · [RDSheet](../../src/app/RDSheetPage.tsx)；查看/编辑权限分离 |
| 问题记录与 AI 定位 /issue-ai | 建立问题、复用方案、分析和闭环 | 列表/筛选/统计；新建 Drawer 两步；详情 ?issue=；AI 对话、附件、根因/方案、采纳与完结 | A · [IssueAiModule](../../src/app/IssueAiModule.tsx)、[List/Detail/NewIssue](../../src/app/issue-ai/)、issues |
| 审批流配置 /rd-approval-flow | 定义研发审核入口与审核池 | 流程选择、节点列表、添加/删除、成员、恢复默认、保存；多节点与 SLA 有预留提示 | A/部分预留 · [RDApprovalFlow](../../src/app/RDApprovalFlowPage.tsx)；页面明确首节点当前生效 |
| 研发 AI 策略 /rd-ai-settings | 调整文件处理、场景模型与复核策略 | 主/备模型、Prompt 版本、置信度、人工复核、OCR 兜底、文件类型规则、用户披露；统一保存 | A · [RDAiSettings](../../src/app/RDAiSettingsPage.tsx) |
| 协同任务驾驶舱 /us-collab-cockpit | 管理中美协作任务 | 复用研发驾驶舱但隐藏子系统全景；独立任务、人员、报告与分派上下文 | A · App + RDTaskManagement，workspace=us-collab |
| 协同工作台 /us-collab-workspace | 执行个人协同任务并处理通知 | 工作台任务弹层、进度、协作、成果与审批 | A · RDMyWorkspace，独立工作区 |
| 协同任务详情 /us-collab-task/:taskId | 查看跨时区任务交付与证据 | 进展留痕/任务讨论/操作记录/附件库；编辑、移交、审核、标记完成、导出过程报告 | A · [UsCollabTaskDetail](../../src/app/UsCollabTaskDetailPage.tsx)；与研发详情功能已不完全一致 |
| 协同人员管理 /us-collab-people-management | 管理协同成员与负载 | 同人员管理结构，按协同工作区读取 | A · RDPeopleManagement + rdWorkspace |
| 协同讨论 /us-collab-rd-discussion/:taskId | 按邀请参与协同线程 | 线程页、回复及返回 | A · RDDiscussionInvite |
| 协同知识库 /us-collab-kb | 存取协同团队资料 | 分类、文件/图片、搜索、预览、上传及密级权限 | A · RDKnowledgeBase，kbId=us-collab |
| 协同审批流配置 /us-collab-approval-flow | 管理协同任务审核规则 | 节点、审核池、保存/恢复；预留边界同研发 | A/部分预留 · RDApprovalFlow |
| 协同 AI 策略 /us-collab-ai-settings | 管理协同场景处理策略 | 模型、文件、OCR、复核和披露配置 | A · RDAiSettings；不是独立模型连接库 |

### 供应链、采购订单与库存

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 供应链任务驾驶舱 /proc-cockpit | 管采购流、样品和备货 | 采购任务/样品协同/备货计划三个 Tab；产品、业务线、系统、负责人、状态筛选；新建需求、导出、批量转派/归类、单据匹配、人员管理 | A · [ProcurementCockpit](../../src/app/procurement/ProcurementCockpitPage.tsx) |
| 采购个人工作台 /proc-my-workspace | 按月份、期限推进本人采购事项 | 列表+任务摘要；任务/样品/备货/待到货来源聚合；逾期、跨月/无日期、到货日历及排期；完整详情 Drawer、原订单行导航 | A · [ProcMyWorkspace](../../src/app/procurement/ProcMyWorkspacePage.tsx)；来源切换不应被误算为新对象 |
| 我的仓管与质量任务 /proc-operational-tasks | 办理本人待收货/待检验工作 | 本人队列、跨月事项、原单链接和分派历史；普通人员不见团队分派 | A · [OperationalTasksPage](../../src/app/procurement/people/OperationalTasksPage.tsx) + OperationalTasksPanel |
| 物料库 /proc-materials | 管理正式物料身份、分类和库存风险 | 分类/搜索/物料表；详情 Drawer、新增/导入、历史报价；更多管理含分类、AI 分类、安全库存、T+ 配置/同步 | A · [MaterialWorkbench](../../src/app/procurement/MaterialWorkbenchPage.tsx) |
| 全部关键物料 /proc-key-materials | 把会议线索核对到正式料号并跟进月度状态 | 31 条线索目录、范围搜索、正式物料映射/依据/历史、月度面板及原物料详情 | A · [KeyMaterialsPage](../../src/app/procurement/key-materials/KeyMaterialsPage.tsx)；31 条非企业 SKU 总量 |
| 库存齐套中心 /proc-inventory-readiness | 判断 BOM 理论套数、缺口与采购依据 | 型号、目标、BOM 明细、库存/在途依据、来源维护与导出；转物料、订单、备货；预计不等于按期可用 | A · [InventoryReadiness](../../src/app/procurement/InventoryReadinessPage.tsx) |
| 供应商报价库 /proc-quote-book | 按物料比价、按供应商看价格与条件 | 双视图、分类/到期/未报价筛选；报价表、录入 Drawer、导入、模板、导出、删除确认与历史 | A · [QuoteBook](../../src/app/procurement/QuoteBookPage.tsx)；币种/有效期/单位等需保持上下文 |
| 供应链人员管理 /proc-people-management | 管采购负载、交接与仓管/质量分派 | 名录表、全部任务 Drawer、岗位备注、智能分派、交接表单；团队岗位待办面板 | A · [ProcPeopleManagement](../../src/app/procurement/ProcPeopleManagementPage.tsx) |
| 采购订单 /purchase-orders | 查 T+ 原单及到货状态 | 单号/供应商/采购员/日期/状态筛选表、分页、T+ 同步、进入详情 | A · [PurchaseOrders](../../src/app/order-processing/pages/PurchaseOrders.tsx)；原单只读 |
| 采购订单详情 /purchase-orders/:id | 在单据与行的上下文处理交期、收货和履约 | 行表、数量核对、可用日期确认/历史、收货/检验、承诺改期、取消/退货/冲销与覆盖批准；Drawer/Modal；保留原工作台/计划返回 | A · [PurchaseOrderDetail](../../src/app/order-processing/pages/PurchaseOrderDetail.tsx)；补充记录不直接改 ERP |
| 库存管理 /inventory-management | 查询跨仓 SKU 现存/可用/在途及低库存 | 库存表、分类/状态/关键词、同步/导出、SKU 详情 | A · [Inventory](../../src/app/order-processing/pages/Inventory.tsx)；区别物料身份维护与 BOM 齐套 |
| 订货单处理工作台 /order-workbench | 从客户订货单生成可核对发票 | 邮箱/上传来源、订单队列、商品核对、模板、发票编辑生成、PDF 导出；邮箱/模板设置和文件上传 Dialog | A · [Workbench](../../src/app/order-processing/pages/Workbench.tsx)；不是采购下单入口 |

### 生产、仓库与质量

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 生产驾驶舱 /production-dashboard | 按月份查看正式生产目标、现场待办和实际发货 | 月份/搜索/本人筛选、作业卡、发货记录、进入执行；“其他生产协同任务”到 legacy | A · [ProductionDashboard](../../src/app/production/execution/ProductionDashboardPage.tsx) |
| 生产协同任务 /production-dashboard?view=legacy | 管理研发同步或生产协作任务 | RDTaskManagement 的生产工作区；任务树、人员、协同与进展 | A · [App](../../src/app/App.tsx)、rdWorkspace；不是新的正式产量账 |
| 生产任务详情 /production-task/:taskId | 查看生产协同任务的责任/进展/采购动态 | 复用 RDTaskDetail 的生产工作区；详情 Tab、附件、任务操作 | A · RDTaskDetail，page:rd-director-dashboard |
| 生产人员管理 /production-people-management | 管理生产协同成员与任务容量 | 人员表/负载/编辑，复用业务成员管理 | A · RDPeopleManagement；不等于 HR 员工档案 |
| 生产计划与执行 /production-execution | 从月目标、批次、派工推进到完工交付 | 最多七个 Tab；确认月计划、拆批、编制作业、派工、报工、初检/不良、齐套占用、转产资料/ECN、放行、实际发货、档案导出、进展 | A · [ProductionExecution](../../src/app/production/execution/ProductionExecutionPage.tsx)、LifecyclePanel/ReadinessPanel；对象与岗位跨度大 |
| 生产领料 /warehouse-flow | 沿生产来源办理实物交接与库存核对 | 领料表、登记发料、签收、T+ 凭证行核对/撤回；其他领退料/盘点面板；原因与数量表单 | A · [WarehouseFlow](../../src/app/procurement/WarehouseFlowPage.tsx)、WarehouseRecordsPanel；不直接改 T+ 主账 |
| 电子批记录 /ebpr | 按批次记录工序与锁定后修改依据 | 批次导航、工序与参数表、新建批次、提交锁定、修改原因 Modal、审计轨迹 | D · [EBPR](../../src/app/EBPRPage.tsx)；不能据样例文案认定正式电子记录合规 |
| 检验与放行 /inspection-release | 查看 IQC/IPQC/FQC 与 QA 放行 | 检验列表/项目详情、新建检验 Dialog、批准/拒绝确认与原因 | D · [InspectionRelease](../../src/app/InspectionReleasePage.tsx)；与正式执行内放行有职责重叠 |
| BUG 日志分析 /bug-log | 从设备日志识别错误与版本关联 | 日志列表、模拟上传、错误频次/根因/版本时间线、新增版本表单 | D · [BugLog](../../src/app/BugLogPage.tsx) |
| 电子闸门 /electronic-gate | 发布检测标准、协议与连接配置 | 检测规则/人工确认/连接参数/读取协议/返工指令；单项表单、草稿、发布、历史；不是现场执行指令界面 | A · [ElectronicGate](../../src/app/ElectronicGatePage.tsx)、FactoryQcProtocolPanel |
| 设备检测记录 /device-inspection-records | 以当次标准追溯设备检测证据 | 记录搜索/筛选、检测详情、实测/原报文、当次规则/协议、同设备前次对比、人工确认、原始导出 | A · [DeviceInspectionRecords](../../src/app/DeviceInspectionRecordsPage.tsx)；外部客户端上传，页内主要查证 |

### 信息流转、客户、法规与受控知识

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 知识库 /dept-kb | 进入自己有权限的资料库 | 顶部库切换、分类树、列表/网格、搜索、上传、编辑/移动/删除、预览与成员分值管理 | A · [KnowledgeBaseEntry](../../src/app/KnowledgeBaseEntryPage.tsx)、RDKnowledgeBase |
| 部门库 /dept-kb/:id | 定位特定部门资料 | 与统一入口同一工作面，13 个部门 ID，按库权限隔离 | A · 同上；不是 13 套不同产品流程 |
| 研发知识库 /rd-knowledge-base | 沉淀研发资料和任务成果 | 同统一库外壳；研发专属入库、密级、RAG 回填等保留 | A · 同上；更多中的索引维护为管理动作 |
| 对外资料版本 /external-docs | 建立对外资料可信版本并人工确认差异 | 资料列表、首版/新版本上传、基准与候选文件、差异复核、原文定位、重试/替换候选、归档摘要/锁定、版本下载 | A · [ExternalDocs](../../src/app/ExternalDocsPage.tsx) |
| 售后 Case 管理 /after-sales | 分流客户设备故障并跟踪响应 | 状态/搜索/表格、新建、状态推进与工单详情 | D · [AfterSalesList](../../src/app/AfterSalesList.tsx)；本地样例队列 |
| 新建售后工单 /after-sales/new | 收集客户、设备、问题与证据 | 填写信息 → AI 摘要 → 确认提交；型号/SN/报障日/现象/自查/环境，示例附件 | D · [AfterSalesForm](../../src/app/AfterSalesForm.tsx)；成功提示不代表持久工单 |
| 售后详情 /after-sales/:id | 阅读故障、时间线、处理备注 | AI 重分析、相关任务、状态、附件、备注、删除审批 Dialog | D · [AfterSalesDetails](../../src/app/AfterSalesDetails.tsx) |
| 研发问题分流 /rd-triage | 录入版本/现象并分到处理队列 | 问题表单、模拟附件、分类/历史方案、紧急/普通/补件队列；跳售后/法规 | D · [RDIssues](../../src/app/RDIssues.tsx)；与真实 issue-ai 需统一归属 |
| 注册项目里程碑 /registration-projects | 看 FDA/CE/NMPA 项目进度与资料缺口 | 项目选择、阶段时间线、材料清单、提醒记录及操作弹窗 | D · [RegistrationProjects](../../src/app/RegistrationProjects.tsx) |
| BOM 确认存档 /bom-archive | 追踪版本确认、差异与通知依据 | 版本列表、物料差异、确认链、下游通知、补充原因/关联设计变更 | D · [BOMArchive](../../src/app/BOMArchive.tsx)；不能视为生产 BOM 权威来源 |
| 设计开发变更 /design-changes | 对设计 ECO 发起评审、影响分析与归档 | 变更表、筛选、选择；新建/评审/影响评估/DHF 导出/评审会 Modal | D · [DesignChanges](../../src/app/DesignChangesPage.tsx)；需与实际生产 ECN 保持设计/执行边界 |
| 报关单证 AI /customs-ai | 上传 PI/CI/PL、识别、核差、回填 | 文件类型 Tab、字段比对表、模板卡与处理轨迹；上传演示文件、生成模板/跨页入口 | D · [CustomsAI](../../src/app/CustomsAI.tsx) |
| 报关单证处理 /customs-docs | 修正字段并生成 CI/PL | 文件与字段、异常清单、HS Code 等人工补录、导出 | D · [CustomsDocs](../../src/app/CustomsDocs.tsx)；与上一页为同一任务重叠 |
| 法规知识库 /ra-knowledge | 找法规、条款与适用版本 | 体系/类型/产品筛选、检索、条款与标注/版本历史切换、同步检查 | D · [RAKnowledge](../../src/app/RAKnowledgePage.tsx)；精确/语义入口不证明真实检索服务 |
| 质量文件 DMS /quality-dms | 管受控文件审批与版本 | 类目/文件表/详情、审批流程/版本历史、创建修订、通过/驳回与确认 | D · [QualityDMS](../../src/app/QualityDMSPage.tsx)，明确模拟审批 |
| 全链路追溯 /qa-traceability | 按批次/SN/订单追证据链 | 查询、上游物料/生产/出货/售后时间轴与表格、导出、风险评估确认 | D · [QATraceability](../../src/app/QATraceability.tsx)；不是当前全业务可查证明 |

### 人事行政与费用

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 简历筛选 /resume-screening | 通过岗位规则和 AI 初筛选择候选人 | 岗位规则、邮箱/模型、同步/多文件/文件夹上传、后台筛选任务、二次筛选版本、候选表、详情/简历/AI 问答、状态跟进 | A · [ResumeScreening](../../src/app/ResumeScreeningPage.tsx)；操作、规则和连接设置集中 |
| 应聘登记 /applicant-forms | 发布表单并整理登记记录 | 模板/登记/发布历史 Tab；字段显隐必填、AI 调整预览、草稿与发布版本、手机预览、复制公开链接、记录详情/导出及登记状态更新（含已归档，不等于转员工档案） | A · [ApplicantForms](../../src/app/ApplicantFormsPage.tsx) + applicant-forms 子组件 |
| 公开登记 /apply/:slug | 候选人在手机提交资料 | 版本化字段与阶段填写、附件、校验、提交结果编号；无需内部账号 | A · [PublicApplicantForm](../../src/app/applicant-forms/PublicApplicantFormPage.tsx)；不等于候选人自助后台 |
| 员工入职归档 /employee-archive | 建立员工正式资料并补齐入职材料 | 员工列表/详情、导入/编辑、证件/学历/银行卡/社保/紧急联系人、材料缺项、转正提醒；胸牌模板、定位、编辑和导出 | A · [EmployeeArchive](../../src/app/EmployeeArchivePage.tsx)；胸牌是明显独立子任务 |
| 人员考勤 /attendance | 核对月考勤、补录异常并导出 | 员工/月份、日记录、加班/倒挂/调休/病假；人员详情、补录修正 Modal、月度字段、导入预览确认、正式表导出 | A · [Attendance](../../src/app/AttendancePage.tsx)；以员工档案为人员来源 |
| 费用报销统计 /expense-center | 从票据识别到关联、报销和归档统计 | 凭证管理/归档分类/审批流/发票回购/统计分析；OCR 上传、票据修正、关联付款凭证、新建报销与企业微信提交/回调、影像/详情、设置与导出 | A · [ExpenseModule](../../src/modules/expense/pages/ExpenseModule.tsx)、expenseService；范围远超“统计” |

### AI 创作、沟通与法务工具

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| AI 图像生成 /ui-design | 通过提示词对话生成/修改图像 | 生成设置、会话、图像参考、提示词优化、生成/编辑模式与结果；进入作品库 | A · [UIDesign](../../src/app/UIDesignPage.tsx)、image-generation |
| 图像作品库 /image-library | 复用图像资产并管理分类 | 分类树、日期/模型/搜索、网格/预览、上传/下载/收藏/编辑/删除、模型调用与成本视图 | A · [ImageLibrary](../../src/app/ImageLibraryPage.tsx)；内容与用量管理混合 |
| 视频作品库 /video-library | 创建视频任务并整理视频 | 生成/作品库 Tab，模型/时长/画质/成本提示、生成队列、分类、上传/下载/删除与预览 | A · [VideoLibrary](../../src/app/VideoLibraryPage.tsx)、VideoGenerateForm |
| 多渠道询盘 /inquiry | 看客户意图、回复与线索 | 渠道/意图/客户过滤、会话主从、AI 回复语言/语气、补件、CRM 登记 Modal、业务流转 | D · [Inquiry](../../src/app/InquiryPage.tsx)；CRM/回复不应算真实集成 |
| 会议纪要 /meeting | 将会议内容整理成行动项 | 输入/生成/确认流程展示、结论、行动表、负责人/截止日、新增/删除/状态、历史、导出和推送 | D · [MeetingMinutes](../../src/app/MeetingMinutes.tsx) |
| 邮件 AI 写作 /email-ai | 从业务意图生成外语邮件草稿 | 指令、语言/语气、模板、历史、可编辑预览、复制与收件人发送 Modal | D · [EmailAI](../../src/app/EmailAIPage.tsx)，发送至演示通道 |
| 汇报材料压缩 /report-compression | 得到不同长度的汇报摘要 | 粘贴/示例文件、场景、生成 50/100/300 字、复制/重算、导出、结论/证据/行动 | D · [ReportCompression](../../src/app/ReportCompressionPage.tsx) |
| 合同 AI 审查 /contract-review | 演示条款、风险与建议采纳 | 加载预置合同、风险筛选、立场、条款、替代文本、采纳 | D · [ContractReview](../../src/app/ContractReviewPage.tsx)，明确没有真实文件上传或审查服务 |

### 系统治理、运维与帮助

| 页面/路径 | 用户目标与主要功能 | 当前结构、主要操作及表单 | 接入/证据 |
| --- | --- | --- | --- |
| 邮箱管理 /mailbox-management | 维护业务邮箱连接 | 地址检索/分页、启停、新增/编辑凭据、删除确认 | A · [MailboxManagement](../../src/app/MailboxManagementPage.tsx)、integration-management |
| AI模型管理 /ai-model-management | 管理模型连接、调用路由与故障 | 模型连接/路由策略/运行监控/请求明细；模型表单、单个/批量连通测试、回退链、调度/超时/熔断、请求下钻 | A · [AiModelManagement](../../src/app/AiModelManagementPage.tsx)、ai-gateway |
| AI使用情况 /ai-usage | 看跨模型调用与估算成本 | 周期、调用趋势、人员/模型排名、明细下钻、历史回填 | A · [AiUsageDashboard](../../src/app/AiUsageDashboardPage.tsx)；估算不是财务结算 |
| AI使用与反馈 /chat-analytics | 看采用、复用、真实提问及反馈闭环 | 周期、人员/部门下钻、用户详情、反馈处理 | A · [ChatAnalytics](../../src/app/ChatAnalyticsPage.tsx)；不等于调用费用仪表板 |
| 运营素材管理 /content-slots | 管理登录/助手等内容位的素材 | 内容位、动态/固定模式、文案/图片池、预览、生成/历史、月预算闸门 | A · [ContentSlots](../../src/app/ContentSlotsPage.tsx) |
| 翻译管理 /i18n-management | 维护中英文界面词条 | 中文/英文搜索、模块/状态筛选、行编辑、AI 补译、JSON 导入导出 | A · [I18nManagement](../../src/app/I18nManagementPage.tsx) |
| 腾讯OCR配置 /ocr-config-management | 配置共用 OCR 服务 | 启用、凭据、地域/地址/识别动作、来源状态、保存/重载 | A · [OcrConfigManagement](../../src/app/OcrConfigManagementPage.tsx) |
| 部门管理 /departments | 管统一组织目录 | 部门/编码/负责人/分类/状态表、新建编辑删除、用户数量 | A · [DepartmentManagement](../../src/app/DepartmentManagement.tsx) |
| 用户管理 /users | 维护登录账号与角色部门关系 | 用户表、搜索/筛选、新建编辑、启停、删除、重置密码 | A · [UserManagement](../../src/app/UserManagement.tsx) |
| 角色权限 /roles | 维护岗位授权集合 | 角色目录、权限树/搜索、页面/按钮授权、复制/编辑/删除；授权即时保存 | A · [RoleManagement](../../src/app/RoleManagement.tsx) |
| 操作留痕 /audit-log | 跨模块追溯操作主体、对象与结果 | 模块/日期/动作/对象/来源/人员、审计表、前后值/详情、分页与快照 | A · [AuditLog](../../src/app/AuditLogPage.tsx)；已统一研发/采购/协同入口 |
| 页面路由管理 /route-management | 维护授权目录、路径与导航可见性 | 权限分组、页面/按钮类型、搜索、显示隐藏、新增编辑/删除；路径变更需刷新生效 | A · [RouteManagement](../../src/app/RouteManagementPage.tsx) |
| 字典列表 /settings | 管枚举/基础条目及旧邮箱字典 | 类型列表、条目表、搜索/人员/分页、类型/条目 CRUD；email 类型含账号密码 | A · [DictionaryList](../../src/app/DictionaryList.tsx)；与邮箱管理不是同一存储 |
| 运维总览 /ops-center | 判断平台运行健康与问题优先级 | 健康、错误趋势、依赖、慢接口、严重问题及能力接入状态 | A · [OpsCenter section=overview](../../src/app/OpsCenterPage.tsx) |
| 接口与错误 /ops-center/api-errors | 定位失败请求与高频错误 | 接口统计/排序、错误列表/筛选/分页、详情、AI 归因 | A · OpsCenter section=api-errors |
| 数据库监控 /ops-center/database | 观察数据库运行状态 | 数据库状态、连接/查询等监控视图；按真实来源展示 | A · OpsCenter section=database |
| 服务与任务 /ops-center/services-tasks | 查看依赖服务及后台任务运行 | 服务列表、任务状态/执行信息；不据页面名称推定可调度任意任务 | A · OpsCenter section=services-tasks |
| 告警与审计设置 /ops-center/alerts-audit | 管运行提醒与审计留存策略 | 配置读取/编辑/保存、策略状态；执行能力以实际配置说明为准 | A · OpsCenter section=alerts-audit |
| 下载和教程 /downloads | 按平台获取客户端与配置教程 | 平台卡片 → /downloads/:platformId 图文步骤、外部下载、订阅复制 | R/读取配置 · [DownloadTutorial](../../src/app/DownloadTutorialPage.tsx) |
| 操作手册 /manual | 学习具体业务任务 | 主题索引 → /manual/:topicId 步骤与说明，当前内容重点是协同模块 | R · [Manual](../../src/app/ManualPage.tsx)；说明书可能落后实际 Tab 数 |

### 移动视图与开发预览

移动研发/协同/生产任务总览及详情复用 MobileRDCockpit；讨论复用受邀线程页；AI 反馈有 MobileChatAnalyticsPage；样品测试有 MobileProcSampleTestPage。其业务目标分别沿用任务查看/协作、反馈观察、指定测试人提交结果，不作为新业务域重复统计。具体路由见前表，自动跳转边界见 [02](02-navigation-map.md)。

以下均为 **P**，当前只在 DEV 路由中挂载。虽然与正式页面主题相似，也不能假定共用完整数据。

| 预览路径后缀（均在 /__preview 下） | 页面目标与主要功能 | 与正式页面的关系 |
| --- | --- | --- |
| 根目录 | 按业务主题访问预览 | 开发导航，不属于正式首页职责 |
| company-overview | 月份/产品/范围、目标/完工/放行/出货、风险原单、催办草稿 | 不等于正式 Dashboard 的已接入数据 |
| monthly-readiness | 月度齐套、依据、预测/历史快照对比 | 与正式库存齐套、生产计划内齐套分别登记 |
| key-materials | 全量关键线索及月度状态核对 | 正式 /proc-key-materials 已另接 API |
| receipt-disposition | 到货后检验、处置与入库交接 | 正式订单行收货/检验是另一个入口 |
| quality-exceptions | 质量异常、责任/处置/复验/关闭 | 与正式生产异常闭环不可混算数量 |
| warehouse | 库存、发料、生产退料、盘点与审批 | 正式 warehouse-flow/warehouse-records 另有实现 |
| shipments | 放行依据、发货登记、作废/冲销及批次查证 | 正式执行的放行/实际发货另接 API |
| production-overview | 生产目标、任务/人员、质量交付风险 | 不等于新的正式生产总览 |
| production-tasks | 各原单投影形成的全部任务及跨月事项 | 避免建立第二套可写任务账 |
| production-planning | 月计划、批次、派工；?view=schedule 为批次日安排 | 一个路由两个工作视角；正式执行已有批次/派工 |
| field-tasks | 现场任务、接收、报工、不良、领料证据 | 预览工作流不代表正式跨模块联调 |
| production-inspections | 初检、复验、原不良与照片依据 | 不等于 /inspection-release 的本地样例，也不等于正式执行内初检 |
| production-rd | 同一生产异常的技术处理与现场验证 | 与 defects 共享部分浏览器内存会话，不是服务器共用闭环证明 |
| production-transfer | 资料、试装、问题与岗位确认 | 样品及批次为演示；正式 LifecyclePanel 另有资料包/发布 |
| production-defects | 不良分派、处置、复验交接 | 与 production-rd 共享原异常演示链 |
| batch-archives | 批次材料/版本/生产/质量/出货证据与 SN 查询 | 正式执行另有档案 Tab 和 JSON 导出 |
| ecn | 版本差异、适用范围、岗位确认与执行历史 | /design-changes 是另一套本地演示；正式执行有 ECN 动作 |

预览证据：[App 的 DEV 条件与路由](../../src/app/App.tsx#L77)、[preview 目录](../../src/app/preview/)、[生产预览范围文档](../production-frontend-progress.md)、[采购预览范围](../procurement-warehouse-frontend-scope.md)。历史文档中的接入缺口须结合当前正式 API 复核。

## 未计为当前独立页面的文件

- SystemSettings.tsx：App 未挂载；/settings 实际是 DictionaryList。
- RDDirectorDashboardPage.tsx：App 未使用；旧 URL 重定向到新生产总览。
- QuickCapturePage.tsx：只是 AttendancePage 导出兼容，旧路由重定向。
- ModulePage.tsx、EnhancedModulePage.tsx、src/imports/pasted_text/dashboard-home.tsx：不在当前 App 页面注册链；其旧内容不能覆盖实际业务页面判断。
- components/Header.tsx、components/Sidebar.tsx：不是 Root 当前引入的 header_1/sidebar_1。
- RDReportsPanel、RDDailyReportPanel、RDMonthlyReportPanel、绩效弹窗、采购任务 Drawer、库存详情、订单行 Drawer、FactoryQcProtocolPanel、费用模块等为当前页面内功能，不重复计作菜单页面。

## 清单的使用规则

本清单完整登记源码路由，并对当前业务页面、辅助页、移动视图及预览说明职责；没有把 135 条注册项说成 135 个独立页面。未来整合时先确认对象与实际数据来源，再迁移入口：保留历史深链、权限、筛选/选择状态、草稿与原单编号。不要先删除“看起来重复”的实现，再补救业务含义。
