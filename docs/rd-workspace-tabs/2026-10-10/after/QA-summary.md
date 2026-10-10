# 研发工作台 Tab 简化验收

结论：本轮范围未发现待修 P1/P2。

1. 1440 × 992 桌面真实组件：列表进详情、讨论直达正确 Tab、返回保留 keyword/priority/status/due/role，三个快捷操作用 Enter/Space 不冒泡，任务设置跳正式详情后可原路返回。
2. 主责/协助和完成态：筛选及返回正确；完成卡片没有更新进度、移交协作、标记完成，设置为回看。撤销额外权限的主责用户不显示转采购等对应管理入口；其本人完成任务权限仍存在，不能称为全页只读。无页面权限详情拒绝访问。
3. 设置保留能力：桌面和 390 已实际打开截止日期编辑、进展附件维护、并入父任务弹窗；历史截止变更仍有应用入口。旧协同 5 Tab、2 个工作项及嵌入样品组件的显示/关闭已验证。
4. **真实手机路由复核**：主工作台保留原路由；卡片讨论转 `/m/task/PREVIEW-RD-COLLAB?tab=conversation`，实际 MobileRDCockpit 讨论入口在 y=67、高 56px，正文和输入框均在视口内。普通卡片打开移动进度留痕；两条返回链都保留协助角色、关键词、优先级与状态。
5. 27 项首轮组件交互断言、7 项设置补充条件和 4 项真实手机路由断言通过。无 pageerror；检查到的业务写全部 405，没有真实持久化验证。未改产品源码、未接数据库/ERP。

## 证据界限与更正

最初 390 harness 直接渲染桌面详情，与 App 的 `/rd-task` → `/m/task` 规则不一致。因此曾提出的手机讨论定位问题撤销；`discussion-anchor.json`、`discussion-from-list-mobile.png` 等旧图保留为检查历史，不作为实际手机产品缺陷。最终以 `actual-mobile-*.png` / `actual-mobile-route-verification.json` 为准。修正路由后只重测相应手机链路，未重复其他已通过项。

`verification.json` 是首轮组件断言；`settings-verification.json` 是设置补充；`actual-mobile-route-verification.json` 是正确路由的最终结果。样品手机实际使用独立专页，关闭后保留该专页；首轮嵌入组件关闭检查不代替此路由行为。
