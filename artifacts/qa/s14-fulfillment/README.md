# S14 前端数量核对验证

已保留本机服务：`http://127.0.0.1:4184/__qa/s14-fulfillment`。

复现启动：

```sh
node artifacts/qa/s14-fulfillment/harness/server.mjs
```

顶部三个订单入口分别用于超收抵欠、混合单位/坏数据和无明细。顶部失败开关只改本地内存，恢复后点击产品“重新加载”。默认超收抵欠例订购 20、ERP 已到 20，但未收差额 10、超收 10，数量已收齐为 1/2 行。未收齐筛选只显示原第2行，原行收货台账可打开；关闭后保留筛选与焦点。再点“定位第1行”，全部明细恢复并高亮第1行。

这是真实前端组件配合隔离数据。无真实登录、API代理、业务数据写入；业务非GET返回405，未知API返回404。独立接口契约检查：

```sh
node artifacts/qa/s14-fulfillment/harness/verify.mjs
```

最终相关检查：

```sh
node --test scripts/purchase-order-*.test.mjs scripts/order-purchase-refinement.test.mjs scripts/order-processing-horizon-ui.test.mjs scripts/purchase-receipt-*.test.mjs scripts/workspace-arrival-navigation.test.mjs scripts/arrival-calendar-*.test.mjs scripts/material-purchase-order-lines.test.mjs
npm run typecheck
npm run build
```

`tests.txt` 为 151/151；`typecheck.txt` 与 `build.txt` 通过。`baseline/` 保存当前脏工作区的本轮修改前文件及错误表达式复现，不是仓库 HEAD。`changes.patch` 仅包含本轮产品与测试改动。`history-filter-before.txt` 和 `history-filter-after.txt` 记录本轮发现的后退筛选问题红绿回归，`tests-before-fixture-fix.txt` 保留首次联合夹具缺导入失败。

桌面及390×844浏览器已验筛选、分单位摘要、原行台账、定位、无明细、错误恢复，截图仅观察未保存。数据口径详见 `docs/procurement-s14-fulfillment-scope.md`。
