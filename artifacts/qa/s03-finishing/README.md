# S03 时间与采购条件隔离验证

在项目根目录运行：

```sh
node artifacts/qa/s03-finishing/harness/server.mjs
```

访问 `http://127.0.0.1:4183/__qa/s03-finishing`。当前任务已保留运行中的服务。它加载真实前端组件，所有 API 使用本地夹具；无后端代理，业务非 GET 请求返回 501。顶部失败开关只改变内存测试状态，不修改业务数据。夹具沿用既有采购 QA 数据工具，顶部的其他导航不属于本次验收范围。

## 检查路径

1. 默认“阀体样品（本轮待验证）”：时间卡显示预计到货 9 月 13 日、9 月 14 日分派；实际到样与结论提交无记录。展开采购条件，CNY 30 与 USD 5 分别展示，候选报价不进入已确认摘要。
2. 开启 `quotes` 失败后点击“重读采购条件”，显示失败且无旧价格；恢复后“重试采购条件”。“核对原采购任务”打开对应任务，关闭后回到入口。
3. 填写测试结果和结论草稿但不提交。开启 `sample` 失败并刷新，旧时间隐藏、草稿保留且禁用；恢复并重新加载后草稿继续可编辑。切换样品有放弃提示，取消仍保留草稿。
4. 切“支架样品（失败后重送）”：9 月 10 日分派和 9 月 11 日结论标为保留记录，当前仍待到样。
5. 切“旧样品记录（时间待核对）”：非法 2 月 30 日不转换为有效分派，不显示已确认到样。切“包装样品（尚未分派）”：无分派、无已选报价均有明确空态。
6. 在 390×844 查看时间卡、报价卡、说明展开和任务切换；切换后列表自动收起、当前样品区获得焦点。完成后恢复正常视口。

没有提交测试结论，也没有测试真实通知、PDF 或原生刷新提示。混币夹具仅检验历史读展示不合并，与正常写入限制无关。

## 自动验证结果

- `tests.txt`：292 / 292。
- `typecheck.txt`：通过。
- `build.txt`：通过，12.05 秒。

复现测试：

```sh
node --test scripts/sample-timing.test.mjs scripts/sample-commercial-*.test.mjs scripts/proc-sample-facts.test.mjs scripts/procurement-sample-*.test.mjs scripts/sample-technical-files.test.mjs scripts/procurement-workspace-*.test.mjs scripts/procurement-cockpit-ui.test.mjs scripts/procurement-cockpit-refinement.test.mjs scripts/procurement-person-tasks.test.mjs scripts/procurement-rollback.test.mjs
npm run typecheck
npm run build
```

完整范围与数据边界见 `docs/procurement-s03-finishing-scope.md`。截图已在浏览器中观察，没有保存图片文件。
