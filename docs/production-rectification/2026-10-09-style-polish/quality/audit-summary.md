# S06 / S16 / S10 / S11 只读样式检查

检查环境：localhost:5198 隔离虚拟数据预览，真实组件，Chrome；1586×992、390×844；共 22 个截图状态。截图时禁用进入动画以避免中间帧误报。浏览器拦截所有非 GET/HEAD/OPTIONS 写入请求，实际写请求 0、页面错误 0。未修改源码及共享 preview main。

## 发现

1. **S10 手机上传入口远离当前登记表单。** 当前 3 批数据下，表单底部到“上传附件”顶部相隔 2610 px，约 3 个手机屏高；用户需穿过全部批次与统计后上传，再回到上方保存。根因：`PurchaseReceiptDrawer.tsx:335` 表单放在 main 开头，`:372` 的 aside 在 main 全部批次后，`:377` 是唯一上传入口；`purchase-receipt-drawer.css:48` 手机端 aside 仍为 `grid-row:auto`。选择器：`.purchase-receipt-form` 与 `.purchase-receipt-aside .purchase-receipt-panel button`。建议当前表单就近提供同一上传动作和草稿附件列表，保留侧栏历史证据。证据：`S10-mobile-inspect.png`、`S10-mobile-attachments.png`，距离见 `quality-style-observations.json`。

2. **S11 操作颜色与其它三页不一致。** 列表选中、物料链接、数量、接收按钮，以及接收弹窗焦点和“确认保存”均继承紫色 `rgb(66,42,251)`；S10 保存按钮是蓝色 `rgb(21,84,232)`。根因：`WarehouseReturnWorkspace.tsx:55` 根节点无蓝色 token 作用域；`warehouseFlow.css:44,52,63`、`warehouse-return-workspace.css:24` 消费全局 primary。`WarehouseRecordsPanel.tsx:42` 主按钮与 `OperationalDialog.tsx:37` portal 同样无对应主题。选择器：`.warehouse-return-count`、`.warehouse-return-select strong`、`.warehouse-return-quantity strong`、`.warehouse-return-footer button`、`[role=dialog] form button[type=submit]`。建议工作区和关联 portal 使用同一限定范围的主题类，避免改全局。证据：`S11-desktop.png`、`S11-mobile-receive.png`。

3. **S16 放弃未保存内容的二次弹窗失去蓝色主题。** 填写“原因说明”后点击“关闭”，“放弃并关闭”呈紫色，下层“确认主因与责任”仍为蓝色。根因：`QualityAnalysisDialog.tsx:140` 的 `AlertDialogContent` 没有主题类，portal 不继承 `quality-prototype.css:1` 的 `.quality-prototype,.quality-detail`。选择器：`[role=alertdialog] button`，具体为“放弃并关闭”。建议二次弹窗挂同一质量主题类；不要依靠主弹窗祖先继承。证据：`S16-mobile-discard.png`、`S16-desktop-discard.png`。

## 未发现问题

S06 筛选、统计与供应商表；S16 主表单及固定底部按钮；S10 收货/QC 输入；S11 手机卡片、详情和接收表单，在指定尺寸的所查状态均未发现横向溢出或按钮被裁切。S06 没有新增高置信可见问题。

采用：baseline-ui 作控件、层级与布局核查；i-have-adhd 沟通规范。未进行业务提交、DB 连接、迁移或部署。
